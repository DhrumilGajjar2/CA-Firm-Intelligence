import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { API_BASE_PATH } from "@ca-firm/api-contracts";
import type { ApiError, ApiErrorDetail, ApiSuccess } from "@ca-firm/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

export const apiClient = axios.create({
  baseURL: `${API_URL}${API_BASE_PATH}`,
  // Auth uses secure cookies (PRD FR-01); the browser must send them cross-origin.
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

/** Normalised error thrown by every API call so UI code handles one shape. */
export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly errors: ApiErrorDetail[];

  constructor(
    message: string,
    opts: { status: number | null; code: string; errors?: ApiErrorDetail[] },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = opts.status;
    this.code = opts.code;
    this.errors = opts.errors ?? [];
  }
}

function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<Partial<ApiError>>;
    if (err.response) {
      const body = err.response.data;
      return new ApiRequestError(
        body?.message ?? "Something went wrong. Please try again.",
        {
          status: err.response.status,
          code: body?.code ?? "UNKNOWN_ERROR",
          errors: body?.errors,
        },
      );
    }
    return new ApiRequestError(
      "Cannot reach the server. Check your connection and try again.",
      {
        status: null,
        code: "NETWORK_ERROR",
      },
    );
  }
  return new ApiRequestError("Unexpected error.", {
    status: null,
    code: "UNKNOWN_ERROR",
  });
}

/** Performs a request and returns the full standard success envelope (data + meta). */
export async function request<T>(config: AxiosRequestConfig): Promise<ApiSuccess<T>> {
  try {
    const res = await apiClient.request<ApiSuccess<T>>(config);
    return res.data;
  } catch (error) {
    throw toApiRequestError(error);
  }
}

/** Convenience wrapper for callers that only need `data`. */
export async function requestData<T>(config: AxiosRequestConfig): Promise<T> {
  return (await request<T>(config)).data;
}
