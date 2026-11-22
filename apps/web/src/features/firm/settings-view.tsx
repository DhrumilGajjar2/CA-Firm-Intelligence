"use client";

import { useState } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { applyServerErrors } from "@/lib/form-errors";
import {
  FIRM_FIELDS,
  MONTH_FIELD,
  OWNER_ONLY_MESSAGE,
  diffFirmProfile,
  diffSettings,
  firmFormResolver,
  hasKeys,
  isForbiddenError,
  toFormValues,
  type FirmFormValues,
} from "./firm-form";
import { FinancialYearField, FirmProfileFields } from "./firm-profile-fields";
import { FirmFormSkeleton, FirmLoadError } from "./firm-states";
import { useFirmData, useFirmMutations } from "./use-firm";

/** Firm profile and financial-year settings. Owner edits; every other role sees it read-only. */
export function SettingsView() {
  const { data: user } = useCurrentUser();
  const { profile, settings, isPending, isFetching, error, refetch } = useFirmData();

  if (isPending) return <FirmFormSkeleton label="Loading firm settings" />;
  if (!profile || !settings) {
    return <FirmLoadError error={error} onRetry={refetch} retrying={isFetching} />;
  }
  return (
    <SettingsForm
      profile={profile}
      settings={settings}
      canEdit={user?.role === "owner"}
    />
  );
}

function SettingsForm({
  profile,
  settings,
  canEdit,
}: {
  profile: FirmProfile;
  settings: FirmSettings;
  canEdit: boolean;
}) {
  const { updateFirm, updateSettings } = useFirmMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<FirmFormValues>({
    resolver: firmFormResolver,
    defaultValues: toFormValues(profile, settings),
  });

  const current = useWatch({ control }) as FirmFormValues;
  const profilePatch = diffFirmProfile(profile, current);
  const settingsPatch = diffSettings(settings, current);
  const hasChanges = hasKeys(profilePatch) || hasKeys(settingsPatch);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    setSaving(true);
    let nextProfile = profile;
    let nextSettings = settings;

    // Only changed fields are sent. Each call updates the cache on success, so after a partial
    // failure a retry re-sends only what is still unsaved.
    const firmPatch = diffFirmProfile(profile, values);
    if (hasKeys(firmPatch)) {
      try {
        nextProfile = await updateFirm.mutateAsync(firmPatch);
      } catch (error) {
        setSaving(false);
        setFormError(
          isForbiddenError(error)
            ? OWNER_ONLY_MESSAGE
            : applyServerErrors(error, setError, FIRM_FIELDS),
        );
        return;
      }
    }

    const settingsChange = diffSettings(settings, values);
    if (hasKeys(settingsChange)) {
      try {
        nextSettings = await updateSettings.mutateAsync(settingsChange);
      } catch (error) {
        setSaving(false);
        setFormError(
          isForbiddenError(error)
            ? OWNER_ONLY_MESSAGE
            : applyServerErrors(error, setError, [MONTH_FIELD]),
        );
        return;
      }
    }

    reset(toFormValues(nextProfile, nextSettings));
    setSaving(false);
    setSaved(true);
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h2>Firm profile</h2>
        </CardTitle>
        <CardDescription>
          How your firm appears across CA Firm Intelligence. These details are shared by
          everyone in your firm.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-label="Firm settings">
        <CardContent className="flex flex-col gap-4">
          {!canEdit ? (
            <Alert role="status">
              <Info aria-hidden />
              <AlertDescription>
                {OWNER_ONLY_MESSAGE} You can view the details below.
              </AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <legend className="sr-only">Firm profile</legend>
            <FirmProfileFields
              register={register}
              errors={errors}
              currentTimezone={profile.timezone}
            />
            <FinancialYearField register={register} errors={errors} />
          </fieldset>
          <FormErrorAlert message={formError} />
          {saved && !hasChanges ? (
            <Alert role="status">
              <CheckCircle2 aria-hidden />
              <AlertDescription>Firm settings saved.</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="mt-4 justify-end gap-2">
            <Button type="submit" disabled={saving || !hasChanges}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
