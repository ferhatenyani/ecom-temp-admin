import { z } from "zod";
import { ApiError } from "./errors";

/**
 * Every JSON response, success or failure, has the same outer shape. Callers
 * receive `data` or a thrown ApiError; no component ever writes
 * `response.data.data`.
 */

const errorBody = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.looseObject({}).optional(),
  }),
});

/**
 * List endpoints add `meta`. Loose, because analytics adds `money_visible`, the
 * CMS homepage adds a drop report, and an added key must not be a breaking
 * change.
 */
export const listMeta = z.looseObject({
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
  total_pages: z.number(),
});
export type ListMeta = z.infer<typeof listMeta>;

export type Unwrapped<T> = { data: T; meta: Record<string, unknown> | null };

/**
 * Unwrap the envelope and parse the payload.
 *
 * The schemas are loose — `z.looseObject({…})`, Zod 4's name for what Zod 3
 * called `.passthrough()` — so an added field is not a breaking change; only a
 * missing or retyped one is. When the API changes shape the panel fails here,
 * at the boundary, with a legible message, instead of rendering `undefined`
 * three components deep.
 */
export function unwrap<T>(
  schema: z.ZodType<T>,
  body: unknown,
  status: number,
  retryAfter: number | null = null,
): Unwrapped<T> {
  const failure = errorBody.safeParse(body);
  if (failure.success) {
    throw new ApiError({
      status,
      code: failure.data.error.code,
      message: failure.data.error.message,
      details: failure.data.error.details ?? {},
      retryAfter,
    });
  }

  // A non-2xx that did not parse as the error envelope is still a failure; the
  // status is the only trustworthy thing about it. 413 and 415 in particular
  // can come from the web server rather than the API.
  if (status < 200 || status >= 300) {
    throw new ApiError({
      status,
      code: "unexpected_response",
      message: `The API answered ${status} outside the envelope.`,
      retryAfter,
    });
  }

  const envelope = z
    .looseObject({ success: z.literal(true), data: z.unknown() })
    .safeParse(body);
  if (!envelope.success) {
    throw new ApiError({
      status,
      code: "malformed_envelope",
      message: "The API answered 2xx without a success envelope.",
    });
  }

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    throw new ApiError({
      status,
      code: "schema_mismatch",
      message: `The API's shape is not what the panel expects: ${z.prettifyError(parsed.error)}`,
    });
  }

  const meta = envelope.data.meta;
  return {
    data: parsed.data,
    meta: meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null,
  };
}
