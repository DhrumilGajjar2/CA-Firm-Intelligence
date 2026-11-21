import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Engagements" };

export default function EngagementsPage() {
  return (
    <ModulePlaceholder
      title="Engagements"
      description="Track assignments, deadlines and statuses."
      icon={Briefcase}
      phase="P2"
    />
  );
}
