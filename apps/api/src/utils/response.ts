import { z } from "zod";

/**
 * Standard API envelopes (PRD §9.1). Mirrors @ca-firm/shared-types ApiSuccess / ApiError.
 * Use the schema helpers in route `response` definitions so Swagger documents every endpoint consistently.
 */

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  errors: z.array(z.object({ field: z.string().optional(), message: z.string() })),
});

export function successResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data,
    meta: paginationMetaSchema.optional(),
  });
}

export function success<T>(data: T, message = "Success", meta?: PaginationMeta) {
  return { success: true as const, message, data, ...(meta ? { meta } : {}) };
}

export function failure(
  code: string,
  message: string,
  errors: { field?: string; message: string }[] = [],
) {
  return { success: false as const, message, code, errors };
}
