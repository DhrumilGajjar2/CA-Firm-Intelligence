import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <ModulePlaceholder
      title="Dashboard"
      description="Operational and financial overview of your firm."
      icon={LayoutDashboard}
      phase="P3"
    />
  );
}
