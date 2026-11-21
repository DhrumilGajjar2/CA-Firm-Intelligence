import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Finance" };

export default function FinancePage() {
  return (
    <ModulePlaceholder
      title="Finance"
      description="Invoices, payments and outstanding fees."
      icon={Wallet}
      phase="P3"
    />
  );
}
