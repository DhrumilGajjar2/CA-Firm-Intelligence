import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Roadmap phase (PRD §11) in which this module gets built. */
  phase: string;
}

/** Temporary page body for modules scheduled in later phases. Replace per module as it is built. */
export function ModulePlaceholder({
  title,
  description,
  icon,
  phase,
}: ModulePlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title={`${title} is coming in ${phase}`}
        description="This screen is part of the planned roadmap and has not been built yet."
      />
    </>
  );
}
