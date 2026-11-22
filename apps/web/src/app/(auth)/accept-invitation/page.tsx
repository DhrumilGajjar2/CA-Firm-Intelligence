import type { Metadata } from "next";
import { AcceptInvitationForm } from "@/features/auth/accept-invitation-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default function AcceptInvitationPage() {
  return <AcceptInvitationForm />;
}
