import type { Metadata } from "next";
import { TeamView } from "@/features/users/team-view";

export const metadata: Metadata = { title: "Team" };

export default function EmployeesPage() {
  return <TeamView />;
}
