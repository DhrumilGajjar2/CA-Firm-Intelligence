import Link from "next/link";
import { Building2 } from "lucide-react";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-6 py-5">
      <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <Building2 className="size-4" aria-hidden />
      </span>
      <span className="text-sm leading-tight font-semibold">
        CA Firm
        <br />
        Intelligence
      </span>
    </Link>
  );
}
