"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { passwordSchema } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { PasswordRules } from "@/components/forms/password-rules";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { applyServerErrors } from "@/lib/form-errors";
import { authService } from "@/services/auth.service";
import { authFormMutationMeta } from "./use-current-user";

/** The API takes `{ token, password }` (resetPasswordSchema); the confirmation field is UI-only. */
const resetFormSchema = z
  .object({ password: passwordSchema, confirm_password: z.string() })
  .refine((v) => v.password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });
type ResetFormValues = z.infer<typeof resetFormSchema>;

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: "", confirm_password: "" },
  });
  const password = useWatch({ control, name: "password" });

  const reset = useMutation({
    meta: authFormMutationMeta,
    mutationFn: authService.resetPassword,
    onError: (error) => setFormError(applyServerErrors(error, setError, ["password"])),
  });

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reset link is missing</CardTitle>
          <CardDescription>
            This page needs a valid reset link. Open the link from your email, or request
            a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot-password" className="text-primary text-sm hover:underline">
            Request a new reset link
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (reset.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password updated</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="status" className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" aria-hidden />
            <p>Your password has been reset. You can now sign in with it.</p>
          </div>
          <Link href="/login" className="text-primary text-sm hover:underline">
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Pick a password you have not used elsewhere.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(({ password: newPassword }) => {
            setFormError(null);
            reset.mutate({ token, password: newPassword });
          })}
          className="flex flex-col gap-4"
          noValidate
          aria-label="Choose a new password"
        >
          <FormField
            id="password"
            label="New password"
            error={errors.password?.message}
            hint={<PasswordRules id="password-rules" value={password ?? ""} />}
          >
            <PasswordInput
              {...fieldProps("password", errors.password?.message)}
              autoComplete="new-password"
              {...register("password")}
            />
          </FormField>
          <FormField
            id="confirm_password"
            label="Confirm new password"
            error={errors.confirm_password?.message}
          >
            <PasswordInput
              {...fieldProps("confirm_password", errors.confirm_password?.message)}
              autoComplete="new-password"
              {...register("confirm_password")}
            />
          </FormField>

          <FormErrorAlert message={formError} />
          {formError ? (
            <Link
              href="/forgot-password"
              className="text-primary text-center text-sm hover:underline"
            >
              Request a new reset link
            </Link>
          ) : null}

          <Button type="submit" disabled={reset.isPending}>
            {reset.isPending ? "Updating…" : "Reset password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
