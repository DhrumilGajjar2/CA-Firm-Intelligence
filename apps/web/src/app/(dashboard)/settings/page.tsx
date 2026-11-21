import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Settings"
      description="Firm profile, team and account settings."
      icon={Settings}
      phase="P1"
    />
  );
}
