"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { z } from "zod";
import type { InvitationPreview } from "@ca-firm/shared-types";
import { acceptInvitationSchema, type AcceptInvitationInput } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { PasswordRules } from "@/components/forms/password-rules";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isStatus } from "@/lib/error-message";
import { applyServerErrors } from "@/lib/form-errors";
import { ROLE_LABELS } from "@/lib/roles";
import { authService } from "@/services/auth.service";
import { AuthCardSkeleton } from "./auth-states";
import { currentUserQueryKey, useCurrentUser, authFormMutationMeta } from "./use-current-user";

/** The API takes `{ token, name, password }` (acceptInvitationSchema); the confirmation is UI-only. */
const acceptFormSchema = acceptInvitationSchema
  .pick({ name: true, password: true })
  .extend({ confirm_password: z.string() })
  .refine((v) => v.password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });
type AcceptFormValues = z.infer<typeof acceptFormSchema>;

const invitationPreviewKey = (token: string) => ["auth", "invitation-preview", token];

function MessageCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children ? (
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      ) : null}
    </Card>
  );
}

const LoginLink = () => (
  <Link href="/login" className="text-primary text-sm hover:underline">
    Go to sign in
  </Link>
);

/** Public page behind the link an owner shares: preview the invitation, then create the account. */
export function AcceptInvitationForm() {
  const token = useSearchParams().get("token");
  if (!token) {
    return (
      <MessageCard
        title="Invitation link is missing"
        description="This page needs an invitation link. Open the link you were sent, or ask your firm owner for a new one."
      >
        <LoginLink />
      </MessageCard>
    );
  }
  return <InvitationLoader token={token} />;
}

function InvitationLoader({ token }: { token: string }) {
  const preview = useQuery({
    queryKey: invitationPreviewKey(token),
    queryFn: () => authService.getInvitation(token),
    retry: false,
    // One-time link: never re-check it in the background (it turns "used" once accepted).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (preview.isPending) return <AuthCardSkeleton />;

  if (preview.isError) {
    if (isStatus(preview.error, 404)) {
      return (
        <MessageCard
          title="This invitation link is not valid"
          description="The link is invalid, has expired, was revoked, or has already been used. Ask your firm owner to send you a new invitation."
        >
          <LoginLink />
        </MessageCard>
      );
    }
    return (
      <MessageCard
        title="We couldn't load this invitation"
        description={preview.error.message}
      >
        <Button
          onClick={() => void preview.refetch()}
          disabled={preview.isFetching}
          className="self-start"
        >
          {preview.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </MessageCard>
    );
  }

  return <AcceptForm token={token} preview={preview.data} />;
}

function AcceptForm({ token, preview }: { token: string; preview: InvitationPreview }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: signedInUser } = useCurrentUser();
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<AcceptFormValues>({
    resolver: zodResolver(acceptFormSchema),
    defaultValues: { name: "", password: "", confirm_password: "" },
  });
  const password = useWatch({ control, name: "password" });

  const accept = useMutation({
    meta: authFormMutationMeta,
    mutationFn: (input: AcceptInvitationInput) => authService.acceptInvitation(input),
    onSuccess: (user) => {
      // Accepting replaces any session on this browser: drop whatever the previous user had cached
      // (keeping the auth entries, so this page does not re-request the now used invitation).
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(currentUserQueryKey, user);
      router.replace("/dashboard");
    },
    onError: (error) => {
      setShowLoginLink(false);
      if (isStatus(error, 409)) {
        setShowLoginLink(true);
        setFormError(
          "An account with this email address already exists, so this invitation cannot be accepted. Sign in with that account instead.",
        );
      } else if (isStatus(error, 404)) {
        setShowLoginLink(true);
        setFormError(
          "This invitation is no longer valid. It may have expired, been revoked or already been used. Ask your firm owner for a new one.",
        );
      } else {
        setFormError(applyServerErrors(error, setError, ["name", "password"]));
      }
    },
  });

  const busy = accept.isPending || accept.isSuccess;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Join {preview.firm_name}</h1>
        </CardTitle>
        <CardDescription>
          You have been invited as {ROLE_LABELS[preview.role]}. Choose a name and password
          to create your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(({ name, password: chosen }) => {
            setFormError(null);
            setShowLoginLink(false);
            accept.mutate({ token, name, password: chosen });
          })}
          className="flex flex-col gap-4"
          noValidate
          aria-label="Accept invitation"
        >
          {signedInUser ? (
            <Alert role="status">
              <Info aria-hidden />
              <AlertDescription>
                You are currently signed in as {signedInUser.email}. Accepting this
                invitation will sign you out of that account and sign you in as the new
                one.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="invited-email">Email</Label>
            <Input id="invited-email" type="email" value={preview.email} readOnly />
          </div>
          <FormField id="name" label="Your name" error={errors.name?.message}>
            <Input
              {...fieldProps("name", errors.name?.message)}
              autoComplete="name"
              {...register("name")}
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
          <FormField
            id="confirm_password"
            label="Confirm password"
            error={errors.confirm_password?.message}
          >
            <PasswordInput
              {...fieldProps("confirm_password", errors.confirm_password?.message)}
              autoComplete="new-password"
              {...register("confirm_password")}
            />
          </FormField>

          <FormErrorAlert message={formError} />
          {showLoginLink ? <LoginLink /> : null}

          <Button type="submit" disabled={busy}>
            {accept.isPending
              ? "Creating account…"
              : accept.isSuccess
                ? "Redirecting…"
                : "Accept invitation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
