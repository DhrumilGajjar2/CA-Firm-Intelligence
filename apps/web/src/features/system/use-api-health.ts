"use client";

import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@ca-firm/api-contracts";
import { requestData } from "@/lib/api-client";

interface HealthData {
  status: "ok";
  database: "up";
  uptime_seconds: number;
  timestamp: string;
}

/** GET /health: confirms the frontend can reach the API and the API can reach its database. */
export function useApiHealth() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: () =>
      requestData<HealthData>({ method: "GET", url: endpoints.system.health }),
    retry: false,
    refetchInterval: 30_000,
  });
}
