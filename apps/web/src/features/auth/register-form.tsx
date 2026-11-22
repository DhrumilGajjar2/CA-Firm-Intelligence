"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerSchema, type RegisterInput } from "@ca-firm/validation";
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
import { Input } from "@/components/ui/input";
import { applyServerErrors } from "@/lib/form-errors";
import { authService } from "@/services/auth.service";
import { currentUserQueryKey, authFormMutationMeta } from "./use-current-user";
import { useNextPath } from "./use-next-path";

const FIELDS = ["name", "email", "password", "firm_name"] as const;

export function RegisterForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const nextPath = useNextPath();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", firm_name: "" },
  });
  const password = useWatch({ control, name: "password" });

  const registration = useMutation({
    meta: authFormMutationMeta,
    mutationFn: authService.register,
    onSuccess: (user) => {
      queryClient.setQueryData(currentUserQueryKey, user);
      router.replace(nextPath);
    },
    onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Register your firm. You will be its owner and can invite your team later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            registration.mutate(values);
          })}
          className="flex flex-col gap-4"
          noValidate
          aria-label="Create your account"
        >
          <FormField id="name" label="Your name" error={errors.name?.message}>
            <Input
              {...fieldProps("name", errors.name?.message)}
              autoComplete="name"
              {...register("name")}
            />
          </FormField>
          <FormField id="firm_name" label="Firm name" error={errors.firm_name?.message}>
            <Input
              {...fieldProps("firm_name", errors.firm_name?.message)}
              autoComplete="organization"
              {...register("firm_name")}
            />
          </FormField>
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
            hint={<PasswordRules id="password-rules" value={password ?? ""} />}
          >
            <PasswordInput
              {...fieldProps("password", errors.password?.message)}
              autoComplete="new-password"
              {...register("password")}
            />
          </FormField>

          <FormErrorAlert message={formError} />

          <Button type="submit" disabled={registration.isPending}>
            {registration.isPending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
