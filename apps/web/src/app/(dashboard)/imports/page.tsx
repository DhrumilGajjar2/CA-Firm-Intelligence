import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Imports" };

export default function ImportsPage() {
  return (
    <ModulePlaceholder
      title="Imports"
      description="Import clients and data from CSV or Excel files."
      icon={Upload}
      phase="P2"
    />
  );
}
