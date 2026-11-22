"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { applyServerErrors } from "@/lib/form-errors";
import { authService } from "@/services/auth.service";
import { authFormMutationMeta } from "./use-current-user";

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const forgot = useMutation({
    meta: authFormMutationMeta,
    mutationFn: authService.forgotPassword,
    onError: (error) => setFormError(applyServerErrors(error, setError, ["email"])),
  });

  if (forgot.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="status" className="flex items-start gap-3 text-sm">
            <MailCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <p>
              If an account exists for that email, a password reset link has been sent.
              The link expires in 1 hour.
            </p>
          </div>
          <Link href="/login" className="text-primary text-sm hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send you a link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            forgot.mutate(values);
          })}
          className="flex flex-col gap-4"
          noValidate
          aria-label="Reset your password"
        >
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              {...fieldProps("email", errors.email?.message)}
              type="email"
              autoComplete="email"
              {...register("email")}
            />
          </FormField>

          <FormErrorAlert message={formError} />

          <Button type="submit" disabled={forgot.isPending}>
            {forgot.isPending ? "Sending…" : "Send reset link"}
          </Button>
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground text-center text-sm"
          >
            Back to sign in
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
