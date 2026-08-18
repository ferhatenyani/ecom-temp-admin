import { cookies } from "next/headers";
import { FORWARD_RESPONSE_HEADERS, checkAllowed } from "@/lib/api/allowlist";
import { SESSION_COOKIE, cookieOptions, seal, unseal } from "@/lib/session/seal";

/**
 * The only place in the panel where a credential is attached to a request.
 *
 * The browser never holds an Application Password, never sees one in a payload
 * and never talks to the WordPress host directly. A leaked Application Password
 * is full admin access to the shop.
 *
 * This is an allowlist, not a pass-through: a generic proxy under `/wp-json/`
 * would be an open relay to `/wp/v2/users` with an admin credential attached.
 */

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";

async function handle(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: segments } = await ctx.params;
  const method = request.method.toUpperCase();

  const allowed = checkAllowed(segments, method);
  if (!allowed.allowed) {
    // 404 for an unknown path and 405 for a known path with the wrong verb. The
    // distinction is not a leak: the allowlist is in the repository, and telling
    // a developer which of the two they got wrong saves an hour.
    return Response.json(
      {
        success: false,
        error: {
          code: allowed.reason === "method" ? "method_not_allowed" : "not_found",
          message:
            allowed.reason === "method"
              ? `${method} is not permitted on this route through the panel proxy.`
              : "This route is not on the panel's allowlist.",
        },
      },
      { status: allowed.reason === "method" ? 405 : 404 },
    );
  }

  const jar = await cookies();
  const session = await unseal(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return Response.json(
      { success: false, error: { code: "unauthenticated", message: "No session." } },
      { status: 401 },
    );
  }

  const target = new URL(`${BASE}${allowed.path}`);
  for (const [key, value] of new URL(request.url).searchParams) {
    target.searchParams.append(key, value);
  }

  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${session.username}:${session.password}`).toString("base64")}`,
        ...(body && body.byteLength > 0
          ? { "Content-Type": request.headers.get("content-type") ?? "application/json" }
          : {}),
      },
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { success: false, error: { code: "network", message: "Could not reach the shop." } },
      { status: 503 },
    );
  }

  // Strip every response header we do not need, and never forward `Set-Cookie`
  // from WordPress in either direction.
  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  const payload = await upstream.arrayBuffer();

  if (upstream.status === 401) {
    // The Application Password was revoked or the account was suspended. Holding
    // a dead credential produces a panel that renders and then fails on every
    // action, so the session goes now.
    //
    // A 403 is deliberately not handled here: it means this role cannot do this
    // thing, and clearing the session over one would make a Support Agent unable
    // to stay signed in.
    const cleared = new Response(payload, { status: 401, headers });
    cleared.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`,
    );
    return cleared;
  }

  const response = new Response(payload, { status: upstream.status, headers });

  // Rotate the seal on every successful response, so the 12 hours are since last
  // use rather than since sign-in.
  if (upstream.ok) {
    const options = cookieOptions();
    response.headers.append(
      "Set-Cookie",
      [
        `${SESSION_COOKIE}=${await seal(session)}`,
        `Path=${options.path}`,
        `Max-Age=${options.maxAge}`,
        "HttpOnly",
        "SameSite=Lax",
        options.secure ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
