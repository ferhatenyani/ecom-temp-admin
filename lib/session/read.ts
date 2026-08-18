import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { identity, type Identity } from "@/lib/api/schemas/order";
import { SESSION_COOKIE, unseal, type Session } from "./seal";

/**
 * Reading the session from a Server Component.
 *
 * `/auth/me` is fetched rather than trusted from the cookie: a revoked
 * Application Password or a suspended account still has a perfectly valid cookie,
 * and a panel that renders from the cookie alone renders a shell that fails on
 * every action.
 */

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  return unseal(jar.get(SESSION_COOKIE)?.value);
}

export type Authed = { session: Session; me: Identity };

/**
 * Either an authenticated pair or a redirect to login. A 401 is the only thing
 * that sends someone to the login screen; a 403 is a screen state and never a
 * bounce.
 */
export async function requireSession(locale: string, reason?: string): Promise<Authed> {
  const session = await readSession();
  if (!session) {
    redirect(`/${locale}/login${reason ? `?reason=${reason}` : ""}`);
  }

  try {
    const { data: me } = await acFetch(identity, session, "/auth/me");
    return { session, me };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthFailure) {
      redirect(`/${locale}/login?reason=${error.isSuspended ? "suspended" : "expired"}`);
    }
    throw error;
  }
}
