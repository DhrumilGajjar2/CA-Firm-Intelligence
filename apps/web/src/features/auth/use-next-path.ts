"use client";

import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/safe-redirect";

/** Post-login destination: the validated `?next=` path, else the dashboard. */
export function useNextPath(): string {
  const params = useSearchParams();
  return safeNextPath(params.get("next"));
}
