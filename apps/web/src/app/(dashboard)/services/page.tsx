import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <ModulePlaceholder
      title="Services"
      description="Configure the professional services your firm offers."
      icon={Layers}
      phase="P2"
    />
  );
}
