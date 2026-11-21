import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return (
    <ModulePlaceholder
      title="Employees"
      description="View team members, roles and workload."
      icon={UserCog}
      phase="P1"
    />
  );
}
