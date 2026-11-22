"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginSchema, type LoginInput } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
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
import { currentUserQueryKey, authFormMutationMeta } from "./use-current-user";
import { useNextPath } from "./use-next-path";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const nextPath = useNextPath();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const login = useMutation({
    meta: authFormMutationMeta,
    mutationFn: authService.login,
    onSuccess: (user) => {
      queryClient.setQueryData(currentUserQueryKey, user);
      router.replace(nextPath);
    },
    onError: (error) =>
      setFormError(applyServerErrors(error, setError, ["email", "password"])),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Access your firm&apos;s dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            login.mutate(values);
          })}
          className="flex flex-col gap-4"
          noValidate
          aria-label="Sign in"
        >
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              {...fieldProps("email", errors.email?.message)}
              type="email"
              autoComplete="email"
              {...register("email")}
            />
          </FormField>
          <FormField
            id="password"
            label="Password"
            error={errors.password?.message}
            labelAside={
              <Link
                href="/forgot-password"
                className="text-primary text-xs hover:underline"
              >
                Forgot password?
              </Link>
            }
          >
            <PasswordInput
              {...fieldProps("password", errors.password?.message)}
              autoComplete="current-password"
              {...register("password")}
            />
          </FormField>

          <FormErrorAlert message={formError} />

          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            New firm?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
