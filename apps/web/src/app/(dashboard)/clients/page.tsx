import type { Metadata } from "next";
import { Users } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <ModulePlaceholder
      title="Clients"
      description="Manage your firm's clients and their service relationships."
      icon={Users}
      phase="P2"
    />
  );
}
