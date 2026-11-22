import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/firm/onboarding-wizard";

export const metadata: Metadata = { title: "Set up your firm" };

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
