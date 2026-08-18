import "server-only";
import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

/**
 * The session cookie is **encrypted, not signed** — the payload *is* the
 * credential. A signed-but-readable cookie hands the shop's Application Password
 * to anyone who reads a proxy log.
 *
 * `server-only` at the top of this file is load-bearing: importing it from a
 * client component is a build error rather than a leaked credential.
 */

export const SESSION_COOKIE = "ac_admin_session";

/** 12 hours, rolling — a warehouse phone left on a bench is the threat model. */
export const SESSION_MAX_AGE = 12 * 60 * 60;

const sessionPayload = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  userId: z.number(),
});
export type Session = z.infer<typeof sessionPayload>;

let cachedKey: Uint8Array | null = null;

function key(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
        "It is the key that encrypts staff credentials at rest in the cookie.",
    );
  }
  // A256GCM needs exactly 32 bytes. SHA-256 of the secret produces them
  // deterministically without demanding the operator generate base64, and
  // `createHash` is synchronous so the hot path stays sync. Folding the bytes by
  // hand instead — XOR into a 32-byte window — would throw away most of a long
  // secret's entropy, which is the opposite of what a longer secret is for.
  cachedKey = new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
  return cachedKey;
}

export async function seal(session: Session): Promise<string> {
  return new EncryptJWT(session)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .encrypt(key());
}

/**
 * Returns null rather than throwing on anything malformed, expired or sealed
 * with a rotated key. A dead cookie and no cookie lead to the same place — the
 * login screen — and distinguishing them would only tell an attacker which of
 * the two they achieved.
 */
export async function unseal(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key());
    const parsed = sessionPayload.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The one place cookie attributes are decided. */
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // `strict` breaks returning from an external payment provider's dashboard;
    // `lax` is sufficient because every mutation is a POST from same-origin
    // script.
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
