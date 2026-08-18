import { cookies } from "next/headers";
import { z } from "zod";
import { acFetch } from "@/lib/api/client";
import { ApiError, NetworkError } from "@/lib/api/errors";
import { identity } from "@/lib/api/schemas/order";
import { SESSION_COOKIE, cookieOptions, seal } from "@/lib/session/seal";

/**
 * Login and logout. The only route that ever receives a password from the
 * browser, and it does not keep one anywhere a client can reach: the credential
 * goes into the sealed cookie and into nothing else.
 */

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof loginBody>;
  try {
    parsed = loginBody.parse(await request.json());
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Username and password are required." } },
      { status: 400 },
    );
  }

  // A WordPress Application Password is displayed with spaces in it, and people
  // paste it as displayed. WordPress itself ignores them, so stripping here makes
  // "abcd EFGH ijkl" and "abcdEFGHijkl" the same credential rather than one
  // working and the other answering 401 for no visible reason.
  const password = parsed.password.replace(/\s+/g, "");
  const session = { username: parsed.username, password, userId: 0 };

  try {
    const { data: me } = await acFetch(identity, session, "/auth/me");

    const jar = await cookies();
    jar.set(SESSION_COOKIE, await seal({ ...session, userId: me.id }), cookieOptions());

    // The identity goes back so the client can render immediately. The password
    // is not part of it, and `me` carries no credential of any kind.
    return Response.json({ data: me });
  } catch (error) {
    if (error instanceof ApiError) {
      // Do not say whether the username exists. A 401 is a 401 — except for a
      // suspended account, where signing in again will never help and silence
      // would send the person round the loop forever.
      const suspended = error.isSuspended;
      return Response.json(
        {
          error: {
            code: suspended ? "account_suspended" : "unauthenticated",
            message: suspended ? "This account is suspended." : "Sign-in failed.",
          },
        },
        {
          status: error.status === 429 ? 429 : 401,
          // This is the API's failed-login bucket and it is real: 10 per 15
          // minutes per IP, and a locked-out address is refused even with the
          // correct password.
          headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined,
        },
      );
    }
    if (error instanceof NetworkError) {
      return Response.json(
        { error: { code: "network", message: "Could not reach the shop." } },
        { status: 503 },
      );
    }
    throw error;
  }
}

/**
 * Logout. Clearing the cookie is all the panel can do — it cannot revoke the
 * Application Password, which is why they are minted per device with a name.
 */
export async function DELETE() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return new Response(null, { status: 204 });
}
