/**
 * The login form, rendered — and above all the three selectors eleven e2e spec
 * files depend on.
 *
 * **This file is the only defence those specs have here.** `signIn` is duplicated
 * verbatim in `admin`, `analytics`, `campaigns`, `content`, `coupons`,
 * `customers`, `inventory`, `notifications`, `orders`, `products` and `shipping`,
 * each filling `#username` and `#password` and clicking a single
 * `button[type="submit"]` — and **none of them can run in this environment**,
 * because they need a live Application Password nobody has. So a change to the
 * ids or to the submit button would be caught by nothing at all until somebody
 * with credentials ran the suite. It is caught here instead, at the cost of one
 * render.
 *
 * The other four things asserted are the defects this branch fixed, and each of
 * them shipped:
 *
 *   1. a required field showed `aria-invalid` and **no message** — §3.4 asks for
 *      the message and the retired screen rendered nothing beside the field
 *   2. every refusal that was not a 429 or a suspension read *"wrong username or
 *      password"*, including an unreachable shop and a malformed request
 *   3. an offline submit was an **unhandled rejection**, because the `fetch` had
 *      no try/catch at all
 *   4. a successful sign-in went to `/orders` unconditionally, which DECISIONS.md
 *      §11 measures as a 403 for a Support Agent
 *
 * A component test rather than a unit one, because none of it is computable from
 * the source: the ids are a property of the rendered document, the refusal is a
 * property of a `fetch` that has already answered, and the destination is a
 * property of the identity that came back with it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { landingPath } from "@/components/ui/nav-tree";
import { LoginForm } from "@/app/[locale]/(auth)/login/LoginForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}));

function renderForm(props: { reason?: string; noDestination?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <LoginForm locale="fr" {...props} />
    </NextIntlClientProvider>,
  );
}

/** A `/api/session` answer, as the route actually shapes one. */
function answer(init: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    headers: new Headers(init.headers ?? {}),
    json: async () => init.body,
  } as unknown as Response;
}

function fill(username = "manager", password = "abcd EFGH ijkl") {
  fireEvent.change(screen.getByLabelText(fr.login.username), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(fr.login.password), { target: { value: password } });
}

beforeEach(() => {
  replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ────────────────────────────────────────────── 1. the selector contract ─── */

describe("the selectors eleven e2e specs depend on", () => {
  it("emits #username and #password on real inputs", () => {
    const { container } = renderForm();

    const username = container.querySelector("#username");
    const password = container.querySelector("#password");

    expect(username).toBeInstanceOf(HTMLInputElement);
    expect(password).toBeInstanceOf(HTMLInputElement);
    // `page.fill` needs a fillable control, not a div with an id on it.
    expect((username as HTMLInputElement).type).toBe("text");
    expect((password as HTMLInputElement).type).toBe("password");
  });

  it("has exactly one button[type=submit], and it is inside the form", () => {
    const { container } = renderForm();

    const submits = container.querySelectorAll('button[type="submit"]');
    expect(submits).toHaveLength(1);
    expect(submits[0].closest("form")).not.toBeNull();
  });

  it("keeps the ids on the labelled fields, so the label still reaches them", () => {
    renderForm();

    // §3.4: the label is always visible and is the control's accessible name.
    expect(screen.getByLabelText(fr.login.username)).toHaveAttribute("id", "username");
    expect(screen.getByLabelText(fr.login.password)).toHaveAttribute("id", "password");
  });

  it("carries the autofill hints a password manager needs", () => {
    renderForm();

    expect(screen.getByLabelText(fr.login.username)).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText(fr.login.password)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });
});

/* ──────────────────────────────────────────────── 2. required, with words ─── */

describe("a required field says so", () => {
  it("shows the message rather than only setting aria-invalid", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    // Two fields, two messages — and nothing posted.
    await waitFor(() => {
      expect(screen.getAllByText(fr.login.required)).toHaveLength(2);
    });
    expect(screen.getByLabelText(fr.login.username)).toHaveAttribute("aria-invalid", "true");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the message as soon as the field is typed into", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(screen.getAllByText(fr.login.required)).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(fr.login.username), { target: { value: "m" } });
    await waitFor(() => expect(screen.getAllByText(fr.login.required)).toHaveLength(1));
  });
});

/* ────────────────────────────────────────── 3. four refusals, not two ─── */

describe("the refusal names the cause it has actually established", () => {
  it("a wrong credential is the credential sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 401, body: { error: { code: "unauthenticated" } } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.login.failed)).toBeInTheDocument();
  });

  it("a suspended account says so, and does not blame the password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({ status: 401, body: { error: { code: "account_suspended" } } }),
      ),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.login.suspended)).toBeInTheDocument();
    expect(screen.queryByText(fr.login.failed)).toBeNull();
  });

  it("a 429 carries the countdown from Retry-After, in seconds under a minute", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 429, headers: { "retry-after": "45" } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(/45 secondes/)).toBeInTheDocument();
  });

  it("reads the real 15-minute bucket in minutes rather than as 900 seconds", async () => {
    /* The live figure: 10 failed logins per 15 minutes per IP. It rendered
       verbatim as "900 secondes" until this branch, because nothing in the
       harness could produce a 429 to look at. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 429, headers: { "retry-after": "900" } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(/15 minutes/)).toBeInTheDocument();
    expect(screen.queryByText(/900/)).toBeNull();
  });

  it("rounds the wait up, so nobody is sent back before the bucket clears", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 429, headers: { "retry-after": "870" } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    // 14.5 minutes — 14 would be a second refusal with the panel's name on it.
    expect(await screen.findByText(/15 minutes/)).toBeInTheDocument();
  });

  it("prints no figure at all when the header is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ status: 429 })));
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    // The retired screen invented "60 secondes" here, which is a claim about a
    // bucket it had not read.
    expect(await screen.findByText(fr.login.rateLimitedUnknown)).toBeInTheDocument();
  });

  it("a 503 gets its own sentence and the only retry on the screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 503, body: { error: { code: "network" } } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.login.unreachable)).toBeInTheDocument();
    // §3.7-4's retry, and it is genuinely retryable — unlike a wrong password.
    expect(screen.getByRole("button", { name: fr.states.retry })).toBeInTheDocument();
    expect(screen.queryByText(fr.login.failed)).toBeNull();
  });

  it("a 400 is a panel bug and must not accuse the reader's password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 400, body: { error: { code: "invalid_request" } } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.login.unexpected)).toBeInTheDocument();
    expect(screen.queryByText(fr.login.failed)).toBeNull();
    // No retry: pressing again sends the same malformed body.
    expect(screen.queryByRole("button", { name: fr.states.retry })).toBeNull();
  });

  it("a thrown fetch is a message rather than an unhandled rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.login.unreachable)).toBeInTheDocument();
    // And the button comes back, rather than spinning for ever.
    expect(screen.getByRole("button", { name: fr.login.submit })).toBeEnabled();
  });

  it("renders the reason it was sent here with, before anybody types", () => {
    renderForm({ reason: "expired" });
    expect(screen.getByText(fr.login.sessionExpired)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────── 3b. the tone follows the cause ─── */

/**
 * **The banner was `danger` for all five causes**, so an expired session — which
 * is not a failure and not the reader's doing — rendered in the panel's colour
 * for *something is wrong*. DECISIONS.md §8's shipping defect, where four
 * terminal moves were flagged `destructive` and "Livré" painted in
 * `--color-danger-fg`. Found by opening the captures; no assertion in the repo
 * could see it, which is why these exist.
 *
 * The tone is read off `Notice`'s own skin classes rather than a test id, because
 * the class *is* the rendered colour — a test that read a prop would pass on a
 * `Notice` that ignored it.
 */
async function toneOf(status: number, code?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answer({ status, body: code ? { error: { code } } : undefined })),
  );
  const { container } = renderForm();
  fill();
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  const node = await screen.findByRole("alert");
  return node.className;
}

describe("the tone follows the outcome, not the fact that a banner exists", () => {
  it("paints an expired session info — nothing failed and nobody is at fault", () => {
    renderForm({ reason: "expired" });
    const node = screen.getByRole("status");
    expect(node.className).toContain("bg-ui-info-bg");
    expect(node.className).not.toContain("danger");
  });

  it("paints a signed-out session info too", () => {
    renderForm({ reason: "signedout" });
    expect(screen.getByRole("status").className).toContain("bg-ui-info-bg");
  });

  /**
   * The judgement, recorded: **`warning`, not `info` and not `danger`.**
   *
   * Not `info`, because the reader is stopped — no attempt gets them in and the
   * only way forward is a Super Admin, which is exactly why `route.ts:48-50`
   * distinguishes this from a plain 401. Not `danger`, because nothing failed: a
   * suspension is an administrative state somebody set on purpose, and the colour
   * reserved for a failure would name a cause that has not been established.
   */
  it("paints a suspension warning — blocked, but nothing failed", () => {
    renderForm({ reason: "suspended" });
    const node = screen.getByRole("status");
    expect(node.className).toContain("bg-ui-warning-bg");
    expect(node.className).not.toContain("danger");
    expect(node.className).not.toContain("info");
  });

  it("paints a wrong credential danger", async () => {
    expect(await toneOf(401, "unauthenticated")).toContain("bg-ui-danger-bg");
  });

  it("paints a rate limit danger — the same refusal, counted", async () => {
    expect(await toneOf(429)).toContain("bg-ui-danger-bg");
  });

  it("paints an unreachable shop danger — §3.7-4's error state", async () => {
    expect(await toneOf(503, "network")).toContain("bg-ui-danger-bg");
  });

  /**
   * A banner seeded from `?reason=` is on screen at first paint and is read in
   * document order; interrupting with it announces an emergency about a page that
   * has only just arrived. One produced by a submit is the answer to something the
   * person just did.
   */
  it("is polite when it was seeded, and an alert when it answers a submit", async () => {
    const { unmount } = renderForm({ reason: "expired" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 401, body: { error: { code: "unauthenticated" } } })),
    );
    const { container } = renderForm();
    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────── 4. the destination ─── */

describe("the destination is the first screen this reader may open", () => {
  it("sends a reader holding orders to /orders — the common path is unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({ status: 200, body: { data: { capabilities: ["ac_manage_orders"] } } }),
      ),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fr/orders"));
  });

  it("sends a Support Agent to /customers rather than to a 403", async () => {
    /* DECISIONS.md §11, measured: 403 on `/orders` and `/inventory`, 200 on
       `/customers`. The retired screen sent this reader to the first of those. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({
          status: 200,
          body: { data: { capabilities: ["ac_manage_customers", "ac_view_audit_logs"] } },
        }),
      ),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fr/customers"));
  });

  it("refuses an account with no capabilities instead of signing it into a shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ status: 200, body: { data: { capabilities: [] } } })),
    );
    const { container } = renderForm();

    fill();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(fr.states.forbiddenBodyNone)).toBeInTheDocument();
    expect(screen.getByText(fr.states.forbiddenAsk)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // The form is gone: there is nothing left to try.
    expect(screen.queryByRole("button", { name: fr.login.submit })).toBeNull();
  });

  it("renders the same refusal for a session that is already signed in with nothing", () => {
    renderForm({ noDestination: true });
    expect(screen.getByText(fr.states.forbiddenBodyNone)).toBeInTheDocument();
  });
});

/* ───────────────────────────────────────── 5. the helper the four share ─── */

describe("landingPath reads NAV, so the front door cannot disagree with the sidebar", () => {
  it("answers the first entry the reader holds, in NAV's own order", () => {
    expect(landingPath(["ac_manage_orders", "ac_manage_products"])).toBe("/orders");
    expect(landingPath(["ac_manage_products", "ac_view_analytics"])).toBe("/products");
    expect(landingPath(["ac_view_audit_logs"])).toBe("/audit");
  });

  it("answers null for an account that holds none of them", () => {
    expect(landingPath([])).toBeNull();
    expect(landingPath(["not_a_capability"])).toBeNull();
  });
});
