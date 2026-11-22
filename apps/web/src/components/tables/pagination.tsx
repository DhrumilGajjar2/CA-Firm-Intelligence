import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PaginationMeta } from "@ca-firm/shared-types";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  /** Noun for the summary and button labels, e.g. "members". */
  noun?: string;
  disabled?: boolean;
}

/** "Showing 21-40 of 57" with Previous/Next. Page, limit and total all come from the API `meta`. */
export function Pagination({
  meta,
  onPageChange,
  noun = "results",
  disabled,
}: PaginationProps) {
  const { page, limit, total } = meta;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      aria-label={`${noun} pagination`}
      className="flex flex-col items-center justify-between gap-2 sm:flex-row"
    >
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Showing {from}-{to} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          <ChevronLeft aria-hidden /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
