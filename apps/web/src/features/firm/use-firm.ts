"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser } from "@ca-firm/shared-types";
import type { UpdateFirmInput, UpdateFirmSettingsInput } from "@ca-firm/validation";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { firmService } from "@/services/firm.service";

export const firmQueryKey = ["firm", "profile"] as const;
export const firmSettingsQueryKey = ["firm", "settings"] as const;

/** Profile and settings together: both screens need both. */
export function useFirmData() {
  const profile = useQuery({ queryKey: firmQueryKey, queryFn: firmService.getFirm });
  const settings = useQuery({
    queryKey: firmSettingsQueryKey,
    queryFn: firmService.getSettings,
  });
  return {
    profile: profile.data,
    settings: settings.data,
    isPending: profile.isPending || settings.isPending,
    isFetching: profile.isFetching || settings.isFetching,
    error: profile.error ?? settings.error,
    refetch: () => {
      // Only re-request what failed, so a retry does not overwrite good data mid-edit.
      if (profile.isError || !profile.data) void profile.refetch();
      if (settings.isError || !settings.data) void settings.refetch();
    },
  };
}

/**
 * PATCH mutations. Every success writes the server's answer into the firm caches and into the
 * current-user query (`firm.name`, `firm.timezone`, `firm.onboarding_completed`), so the header
 * and the onboarding guard see the change immediately.
 */
export function useFirmMutations() {
  const queryClient = useQueryClient();

  const updateFirm = useMutation({
    mutationFn: (input: UpdateFirmInput) => firmService.updateFirm(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(firmQueryKey, profile);
      queryClient.setQueryData<CurrentUser>(currentUserQueryKey, (user) =>
        user
          ? {
              ...user,
              firm: { ...user.firm, name: profile.name, timezone: profile.timezone },
            }
          : user,
      );
    },
  });

  const updateSettings = useMutation({
    mutationFn: (input: UpdateFirmSettingsInput) => firmService.updateSettings(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(firmSettingsQueryKey, settings);
      queryClient.setQueryData<CurrentUser>(currentUserQueryKey, (user) =>
        user
          ? {
              ...user,
              firm: { ...user.firm, onboarding_completed: settings.onboarding_completed },
            }
          : user,
      );
    },
  });

  return { updateFirm, updateSettings };
}
