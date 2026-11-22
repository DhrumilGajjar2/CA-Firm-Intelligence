"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CurrentUser } from "@ca-firm/shared-types";
import { updateUserSchema, type UpdateUserInput } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { RoleBadge } from "@/features/users/user-badges";
import { useUpdateOwnProfile } from "@/features/users/use-users";
import { applyServerErrors } from "@/lib/form-errors";

/** The signed-in user's own profile: name is editable, everything else is read-only. */
export function ProfileView() {
  const { data: user } = useCurrentUser();
  if (!user) {
    return (
      <div
        role="status"
        aria-label="Loading profile"
        className="flex max-w-2xl flex-col gap-3"
      >
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-1/2" />
      </div>
    );
  }
  return <ProfileForm user={user} />;
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const update = useUpdateOwnProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { name: user.name },
  });

  const current = useWatch({ control, name: "name" });
  const changed = (current ?? "").trim() !== user.name;

  const onSubmit = handleSubmit(({ name }) => {
    setFormError(null);
    setSaved(false);
    // Only the changed value is sent. `name` is already trimmed by the schema.
    if (name === user.name) return;
    update.mutate(
      { id: user.id, input: { name } },
      {
        onSuccess: (updated) => {
          reset({ name: updated.name });
          setSaved(true);
        },
        onError: (error) => setFormError(applyServerErrors(error, setError, ["name"])),
      },
    );
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h2>Your details</h2>
        </CardTitle>
        <CardDescription>
          Your name is shown to your team. Your email and role are managed by your firm.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-label="Profile">
        <CardContent className="flex flex-col gap-4">
          <FormField id="profile-name" label="Name" error={errors.name?.message}>
            <Input
              {...fieldProps("profile-name", errors.name?.message)}
              autoComplete="name"
              {...register("name", {
                onChange: () => setSaved(false),
              })}
            />
          </FormField>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" type="email" value={user.email} readOnly />
          </div>
          <div className="flex flex-col gap-2">
            <Label id="profile-role-label">Role</Label>
            <div aria-labelledby="profile-role-label" role="group">
              <RoleBadge role={user.role} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-firm">Firm</Label>
            <Input id="profile-firm" value={user.firm.name} readOnly />
          </div>

          <FormErrorAlert message={formError} />
          {saved && !changed ? (
            <Alert role="status">
              <CheckCircle2 aria-hidden />
              <AlertDescription>Profile updated.</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="mt-4 justify-end gap-2">
          <Button type="submit" disabled={update.isPending || !changed}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
