"use client";

import { useRef, useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CreatedInvitation } from "@ca-firm/shared-types";
import { inviteUserSchema, type InviteUserInput } from "@ca-firm/validation";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { SelectInput } from "@/components/forms/native-controls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyServerErrors } from "@/lib/form-errors";
import { formatDate } from "@/lib/format";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/roles";
import { useInviteUser } from "./use-users";

/** Owner-only "Invite user" button and dialog. The dialog body remounts on every open, so it starts fresh. */
export function InviteUserDialog({ timezone }: { timezone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus aria-hidden /> Invite user
      </DialogTrigger>
      <DialogContent>
        <InviteBody timezone={timezone} />
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({ timezone }: { timezone: string }) {
  const invite = useInviteUser();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: "", role: "employee" },
  });

  if (invite.data) return <InviteCreated invitation={invite.data} timezone={timezone} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogDescription>
          They join your firm with the role you choose. You get a link to share with them.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          invite.mutate(values, {
            onError: (error) =>
              setFormError(applyServerErrors(error, setError, ["email", "role"])),
          });
        })}
        className="flex flex-col gap-4"
        noValidate
        aria-label="Invite a user"
      >
        <FormField id="invite-email" label="Email" error={errors.email?.message}>
          <Input
            {...fieldProps("invite-email", errors.email?.message)}
            type="email"
            autoComplete="off"
            {...register("email")}
          />
        </FormField>
        <FormField id="invite-role" label="Role" error={errors.role?.message}>
          <SelectInput
            {...fieldProps("invite-role", errors.role?.message)}
            {...register("role")}
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </SelectInput>
        </FormField>

        <FormErrorAlert message={formError} />

        <DialogFooter className="mx-0 mb-0 bg-transparent p-0 pt-2">
          <DialogClose render={<Button variant="outline" disabled={invite.isPending} />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Creating…" : "Create invitation"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function InviteCreated({
  invitation,
  timezone,
}: {
  invitation: CreatedInvitation;
  timezone: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(invitation.invite_url);
      setCopy("copied");
    } catch {
      // Clipboard can be blocked (insecure origin, permissions): select the text so Ctrl+C works.
      inputRef.current?.select();
      setCopy("failed");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invitation created</DialogTitle>
        <DialogDescription>
          Share this link with {invitation.email}. They will join as{" "}
          {ROLE_LABELS[invitation.role]}. It expires on{" "}
          {formatDate(invitation.expires_at, timezone)}.
        </DialogDescription>
      </DialogHeader>

      <Alert role="status">
        <AlertDescription>
          This link is shown only once. Email is not sent in this version, so copy it now
          and send it to them yourself.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-url">Invitation link</Label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id="invite-url"
            readOnly
            value={invitation.invite_url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copyLink()}>
            {copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copy === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        {copy === "copied" ? (
          <p role="status" className="text-xs text-green-700 dark:text-green-400">
            Link copied to the clipboard.
          </p>
        ) : null}
        {copy === "failed" ? (
          <p role="status" className="text-destructive text-xs">
            Could not copy automatically. The link is selected: press Ctrl+C to copy it.
          </p>
        ) : null}
      </div>

      <DialogFooter className="mx-0 mb-0 bg-transparent p-0 pt-2">
        <DialogClose render={<Button />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}
