import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/features/firm/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Firm profile and financial-year settings."
      />
      <SettingsView />
    </>
  );
}
