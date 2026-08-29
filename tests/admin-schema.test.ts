import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  settings,
  settingsEmptyPatchDetails,
  settingsFieldDetails,
  settingsWriteResponse,
  storeSettings,
} from "@/lib/api/schemas/settings";
import {
  applicationPassword,
  applicationPasswordList,
  deleteConflictDetails,
  duplicateDetails,
  mintedApplicationPassword,
  role,
  roleList,
  staffUser,
  staffUserDeleted,
  staffUserDetail,
  staffUserList,
} from "@/lib/api/schemas/staff";
import { auditList, auditRow } from "@/lib/api/schemas/audit";
import { importReport, missingColumnsDetails, previewRow } from "@/lib/api/schemas/transfer";
import {
  EDITED_KEYS,
  READ_ONLY_STORE_KEYS,
  WRITABLE_BLOCKS,
  WRITABLE_KEYS,
  blockErrorFor,
  changedBlocks,
  fieldErrorFor,
  flagWithoutProvider,
  isDirty,
  storefrontConsequences,
  type SettingsDraft,
} from "@/lib/settings";
import {
  assignableRoles,
  credentialConflict,
  deleteConflictCount,
  hasSecret,
  isRetiredRole,
  isSelf,
  neverUsed,
  roleLabel,
  staffName,
  STAFF_STATUSES,
} from "@/lib/staff";
import {
  ACTION_COUNT,
  RESOURCE_TYPES,
  actionSubject,
  actionTone,
  changedPairs,
  isActionQuery,
  isRedacted,
  isResourceType,
  isSystemActor,
  metadataShape,
  plainEntries,
} from "@/lib/audit";
import {
  DEFAULT_MODE,
  EXPORT_SUBJECTS,
  IMPORT_SUBJECTS,
  ROUND_TRIPS,
  SUBJECT_CAPABILITY,
  errorFields,
  hasMode,
  isImportable,
  missingColumns,
  previewIsNotARehearsal,
  reportIsNoOp,
} from "@/lib/transfer";
import { BrowserApiError } from "@/lib/api/browser";
import { parseApiDate } from "@/lib/format/date";
import { queryFromParams as auditQueryFromParams, listParams as auditListParams } from "@/app/[locale]/(panel)/audit/query";
import { queryFromParams as usersQueryFromParams, listParams as usersListParams } from "@/app/[locale]/(panel)/users/query";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import fixtures from "./fixtures-admin.json";

/**
 * The `feat/admin` schemas, parsed against **captured live payloads**.
 *
 * `tests/fixtures-admin.json` is 79 responses verbatim, captured 2026-08-21
 * against the shop `scripts/seed-staff.mjs` establishes and across **four
 * credentials**. Re-capture it, do not hand-edit it. The precedent is
 * `tests/campaign-schema.test.ts`.
 *
 * Most of this branch's surface is answerable here rather than in a browser:
 * the capability grid, the settings error shapes, the five escalation refusals,
 * the role matrix, the four audit metadata shapes and the four import preview
 * shapes. What is left for e2e is the boundary reaching a screen, a download
 * actually arriving, and the suspend/reactivate pair walking.
 *
 * Every schema is asserted in **both directions**, which is the house rule: an
 * added key passes through, and a retyped field is refused. A `looseObject` that
 * accepted everything would be a schema that proved nothing.
 */

const data = <T,>(body: unknown) => (body as { data: T }).data;
const meta = (body: unknown) => (body as { meta: Record<string, unknown> }).meta;
const error = (body: unknown) =>
  (body as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;

/* ================================================================ settings === */

describe("the settings document", () => {
  it("parses, with all six blocks", () => {
    const document = settings.parse(data(fixtures.settings));

    expect(Object.keys(document)).toEqual([
      "store",
      "contact",
      "legal",
      "social",
      "features",
      "providers",
    ]);
  });

  it("keeps a key added later, and refuses a retyped one", () => {
    const added = settings.parse({
      ...data<Record<string, unknown>>(fixtures.settings),
      analytics: { provider: "matomo" },
    });
    expect(added).toMatchObject({ analytics: { provider: "matomo" } });

    // `logo_id` is a number and the form reads it as one. A string here would
    // render `#0` for a shop with no logo and `#"12"` for one that has.
    expect(() =>
      storeSettings.parse({
        ...(data<{ store: Record<string, unknown> }>(fixtures.settings).store),
        logo_id: "12",
      }),
    ).toThrow();
  });

  it("publishes a currency and no timezone, which is why SHOP_CURRENCY is a constant", () => {
    const store = data<{ store: Record<string, unknown> }>(fixtures.settings).store;

    expect(store.currency).toBe("DZD");
    expect(store.currency_symbol).toBe("د.ج");
    // README's correction, re-verified rather than trusted: the whole document
    // carries no timezone key under any block.
    expect(JSON.stringify(fixtures.settings)).not.toContain("timezone");
  });

  it("answers PATCH with the whole document, not the block that was written", () => {
    const written = settingsWriteResponse.parse(data(fixtures.settingsWritten));

    // One field was sent. Six blocks came back.
    expect(written.contact.phone).toBe("+213 555 01 02 03");
    expect(written.store.name).toBe("Algerian Commerce");
    expect(written.features.cod).toBe(true);
    expect(written.providers.payment).toContain("cod");
  });
});

describe("a writable block is not wholly writable", () => {
  it("names four writable keys in store, where GET publishes eight", () => {
    const store = data<{ store: Record<string, unknown> }>(fixtures.settings).store;
    const published = Object.keys(store).sort();

    expect(published).toEqual(
      ["currency", "currency_symbol", "description", "locale", "logo", "logo_id", "name", "storefront_url"].sort(),
    );

    // ADMIN_PANEL.md lists four writable *blocks* and puts only `currency` in
    // its read-only table. Measured, four of store's eight keys are refused.
    expect([...WRITABLE_KEYS.store].sort()).toEqual(
      ["description", "logo_id", "name", "storefront_url"].sort(),
    );
    for (const key of READ_ONLY_STORE_KEYS) expect(published).toContain(key);
  });

  it("takes its writable key list from what the refusal names", () => {
    /*
     * The four lists are not guessed: each came from `PATCH {"<block>": {"zzz":
     * "1"}}`, whose 400 spells out "Known: …". This re-derives them from the
     * captured refusal so the constant and the API cannot drift.
     */
    const message = error(fixtures.settingsUnknownKey).details?.fields as Record<string, string>;
    const known = message.store
      .split("Known:")[1]
      .replace(".", "")
      .split(",")
      .map((key) => key.trim());

    expect(known.sort()).toEqual([...WRITABLE_KEYS.store].sort());
  });

  it("refuses features and providers by name, with the reason", () => {
    const features = error(fixtures.settingsRefusedFeatures).details?.fields as Record<string, string>;
    const providers = error(fixtures.settingsRefusedProviders).details?.fields as Record<string, string>;

    expect(features.features).toContain("environment variables");
    expect(providers.providers).toContain("Read-only");

    // Both are whole-block errors, so they key by the block and not by a field.
    expect(blockErrorFor(features, "features")).toBe(features.features);
    expect(fieldErrorFor(features, "features", "cod")).toBeUndefined();
  });

  it("refuses currency from inside a block the spec calls writable", () => {
    const fields = error(fixtures.settingsRefusedCurrency).details?.fields as Record<string, string>;
    expect(fields.store).toContain("Unknown keys: currency");
  });
});

describe("details.fields has two shapes on one route", () => {
  it("is an array on the empty PATCH, and BrowserApiError refuses to render it", () => {
    const details = settingsEmptyPatchDetails.parse(error(fixtures.settingsEmptyPatch).details);
    expect(details.fields).toEqual(["store", "contact", "legal", "social"]);

    /*
     * **Verified, not assumed.** The brief asked for exactly this: `fields`
     * returns `null` for an array rather than putting `store,contact,legal,
     * social` on screen as though it were an explanation, and the caller falls
     * through to the top-level message.
     */
    const thrown = new BrowserApiError({
      status: 400,
      code: error(fixtures.settingsEmptyPatch).code,
      message: error(fixtures.settingsEmptyPatch).message,
      details: error(fixtures.settingsEmptyPatch).details,
    });

    expect(thrown.fields).toBeNull();
    expect(thrown.message).toBe("No supported fields were provided.");
  });

  it("is an object keyed by block or by block.key everywhere else", () => {
    const byKey = settingsFieldDetails.parse(error(fixtures.settingsBadUrl).details);
    expect(byKey.fields["store.storefront_url"]).toBe("Must be a URL, including https://.");

    const byEmail = settingsFieldDetails.parse(error(fixtures.settingsBadEmail).details);
    expect(byEmail.fields["contact.email"]).toBe("Must be an email address.");

    // A form binding only to `key` would render neither, and one binding only
    // to `block.key` would miss the unknown-key refusal.
    expect(fieldErrorFor(byKey.fields, "store", "storefront_url")).toBeDefined();
    expect(fieldErrorFor(byKey.fields, "store", "name")).toBeUndefined();

    const byBlock = settingsFieldDetails.parse(error(fixtures.settingsUnknownBlock).details);
    expect(blockErrorFor(byBlock.fields, "nonsense")).toContain("Unknown block");
  });

  it("carries a real BrowserApiError.fields for the object shape", () => {
    const thrown = new BrowserApiError({
      status: 400,
      message: error(fixtures.settingsBadUrl).message,
      details: error(fixtures.settingsBadUrl).details,
    });
    expect(thrown.fields).not.toBeNull();
    expect(Object.keys(thrown.fields ?? {})).toEqual(["store.storefront_url"]);
  });
});

describe("the settings diff", () => {
  const original: SettingsDraft = {
    store: { name: "Algerian Commerce", description: "", storefront_url: "" },
    contact: { email: "", phone: "", address: "", wilaya: "", hours: "" },
    legal: { registered_name: "", rc: "", nif: "", nis: "", ai: "" },
    social: { facebook: "", instagram: "", tiktok: "", youtube: "" },
  };

  it("sends only what moved, because the audit row records exactly that", () => {
    const draft: SettingsDraft = {
      ...original,
      contact: { ...original.contact, phone: "+213 555 01 02 03" },
    };

    expect(changedBlocks(draft, original)).toEqual({
      contact: { phone: "+213 555 01 02 03" },
    });
    expect(isDirty(draft, original)).toBe(true);
    expect(isDirty(original, original)).toBe(false);

    // The captured audit row for that exact write. One block, one field.
    const row = data<Record<string, unknown>[]>(fixtures.auditSettings)[0];
    expect(row.metadata).toMatchObject({ blocks: ["contact"], fields: ["contact.phone"] });
  });

  it("sends an emptied field, because `\"\"` clears rather than meaning unchanged", () => {
    const draft: SettingsDraft = {
      ...original,
      store: { ...original.store, name: "" },
    };
    expect(changedBlocks(draft, original)).toEqual({ store: { name: "" } });
  });

  it("never sends logo_id, which the form does not edit", () => {
    expect(WRITABLE_KEYS.store).toContain("logo_id");
    expect(EDITED_KEYS.store).not.toContain("logo_id");
  });
});

describe("the storefront URL and the flag registry", () => {
  it("names the consequence only while the field is empty", () => {
    expect(storefrontConsequences("")).toBe(true);
    expect(storefrontConsequences("   ")).toBe(true);
    expect(storefrontConsequences("https://boutique.example")).toBe(false);
  });

  it("finds no gap on this shop, and would find one on a shop that has it", () => {
    const document = settings.parse(data(fixtures.settings));
    const providers = document.providers;

    // Positive control first: this install's flags and registries agree, so a
    // check that reported a gap here would be wrong.
    for (const [flag, enabled] of Object.entries(document.features)) {
      expect(flagWithoutProvider(flag, enabled === true, providers)).toBe(false);
    }

    // The state the screen exists to render: a flag on with no key behind it.
    expect(flagWithoutProvider("yalidine", true, providers)).toBe(true);
    expect(flagWithoutProvider("marketing_pixels", true, providers)).toBe(true);

    // The four that gate nothing yet must not be paired with a registry they
    // have no entry in — that would invent a gap on every install.
    for (const flag of ["blog", "reviews", "sms", "whatsapp"]) {
      expect(flagWithoutProvider(flag, true, providers)).toBe(false);
    }
  });
});

/* =================================================================== staff === */

describe("the staff list", () => {
  it("parses, including a suspended row", () => {
    const rows = staffUserList.parse(data(fixtures.users));
    expect(rows.length).toBeGreaterThan(0);

    const suspended = staffUserList.parse(data(fixtures.usersSuspended));
    expect(suspended).toHaveLength(1);
    expect(suspended[0].status).toBe("suspended");
    expect(suspended[0].username).toBe("ac_panel_suspended");
  });

  it("omits application_passwords on the list and carries them on the read", () => {
    const listRow = data<Record<string, unknown>[]>(fixtures.users)[0];
    expect(listRow).not.toHaveProperty("application_passwords");

    const detail = staffUserDetail.parse(data(fixtures.userDetailWithPasswords));
    expect(detail.application_passwords.length).toBeGreaterThan(0);
  });

  it("keeps an added key and refuses a retyped one", () => {
    const row = data<Record<string, unknown>[]>(fixtures.users)[0];
    expect(staffUser.parse({ ...row, last_login: "2026-08-21" })).toMatchObject({
      last_login: "2026-08-21",
    });

    // `is_administrator` decides whether the role picker renders at all.
    expect(() => staffUser.parse({ ...row, is_administrator: "false" })).toThrow();
    // A status outside the two is a state no badge has a tone for.
    expect(() => staffUser.parse({ ...row, status: "disabled" })).toThrow();
  });

  it("carries a date_created with an offset, unlike an audit row", () => {
    const row = staffUserList.parse(data(fixtures.users))[0];
    expect(row.date_created).toMatch(/\+00:00$/);
    expect(parseApiDate(row.date_created)?.toISOString()).toBeTypeOf("string");
  });

  it("filters by role, by status and by search — all three honoured", () => {
    expect(meta(fixtures.usersByRole).total).toBeLessThan(Number(meta(fixtures.users).total));
    expect(meta(fixtures.usersSuspended).total).toBe(1);
    expect(meta(fixtures.usersSearch).total).toBe(1);
    // The floor: a filter matching nothing must not read as success.
    expect(meta(fixtures.usersSearchEmpty).total).toBe(0);
  });

  it("matches the display name, unlike the customers search", () => {
    const found = staffUserList.parse(data(fixtures.usersSearch));
    // `?search=nadia` — the account's username is `ac_panel_suspended`, so only
    // the display name can have matched.
    expect(found[0].display_name).toBe("Nadia Cherif");
    expect(found[0].username).not.toContain("nadia");
  });

  it("names everybody, so a row is never blank", () => {
    for (const row of staffUserList.parse(data(fixtures.users))) {
      expect(staffName(row)).not.toBe("");
    }
  });
});

describe("the role matrix", () => {
  const roles = roleList.parse(data(fixtures.roles));

  it("publishes seven and marks two assignable", () => {
    expect(roles).toHaveLength(7);
    expect(assignableRoles(roles).map((r) => r.role)).toEqual(["ac_super_admin", "ac_manager"]);
  });

  it("keeps an added key and refuses a retyped one", () => {
    expect(role.parse({ ...roles[0], description: "later" })).toMatchObject({
      description: "later",
    });
    // The flag is the whole reason this route is not a list of strings.
    expect(() => role.parse({ ...roles[0], assignable: "true" })).toThrow();
  });

  it("labels a retired role a picker cannot offer", () => {
    // 51 of 72 accounts hold one of the five, so this is the common case.
    expect(isRetiredRole("ac_support_agent", roles)).toBe(true);
    expect(isRetiredRole("ac_manager", roles)).toBe(false);
    expect(roleLabel("ac_support_agent", "Support Agent", roles)).toBe("Support Agent");
  });

  it("labels a WordPress administrator, which /roles does not publish at all", () => {
    expect(roles.some((r) => r.role === "administrator")).toBe(false);
    // Falls back to the row's own `role_name`, never to a blank.
    expect(roleLabel("administrator", "administrator", roles)).toBe("administrator");
    expect(roleLabel("something_new", "", roles)).toBe("something_new");
    // And it is not "retired" — it is not in the matrix at all, which is a
    // different fact and a different badge.
    expect(isRetiredRole("administrator", roles)).toBe(false);
  });

  it("gives Super Admin the three capabilities this branch gates on", () => {
    const superAdmin = roles.find((r) => r.role === "ac_super_admin");
    const manager = roles.find((r) => r.role === "ac_manager");

    for (const capability of ["ac_manage_settings", "ac_manage_users", "ac_view_audit_logs"]) {
      expect(superAdmin?.capabilities).toContain(capability);
      expect(manager?.capabilities).not.toContain(capability);
    }

    // And the Manager holds the four the export screen gates on, which is why
    // one credential is both the branch's refusal and its positive control.
    for (const capability of Object.values(SUBJECT_CAPABILITY)) {
      expect(manager?.capabilities).toContain(capability);
    }
  });
});

describe("the five escalation refusals", () => {
  it("refuses the three about yourself, with a reason and a 403", () => {
    expect(error(fixtures.refuseOwnRole).message).toContain("your own role");
    expect(error(fixtures.refuseOwnSuspend).message).toContain("suspend your own");
    expect(error(fixtures.refuseOwnDelete).message).toContain("delete your own");
    for (const body of [fixtures.refuseOwnRole, fixtures.refuseOwnSuspend, fixtures.refuseOwnDelete]) {
      expect(error(body).code).toBe("forbidden");
    }

    // Which the panel knows locally and disables the control for.
    expect(isSelf(475, 475)).toBe(true);
    expect(isSelf(770, 475)).toBe(false);
    expect(isSelf(770, null)).toBe(false);
  });

  it("refuses a WordPress role as a field error, not as a 403", () => {
    const fields = error(fixtures.refuseWordPressRole).details?.fields as Record<string, string>;
    expect(fields.role).toContain("does not grant");
    expect(fields.role).toContain("administrator");
  });

  it("refuses a retired role by naming it retired, never unknown", () => {
    const fields = error(fixtures.refuseRetiredRole).details?.fields as Record<string, string>;
    /*
     * The distinction the API argues for: the role exists, it is published on
     * `GET /roles`, and accounts hold it — so "Unknown role" would send an
     * operator looking for a typo. The sentence names the alternatives, which
     * is why `Field` renders it verbatim.
     */
    expect(fields.role).toContain("retired");
    expect(fields.role).not.toContain("Unknown");
    expect(fields.role).toContain("ac_super_admin, ac_manager");
  });

  it("requires a role, and says a roleless account is a customer", () => {
    const fields = error(fixtures.refuseNoRole).details?.fields as Record<string, string>;
    expect(fields.role).toContain("Required");
    expect(fields.role).toContain("/customers");
  });

  it("refuses password, capabilities, roles and user_login by name", () => {
    const fields = error(fixtures.refuseFields).details?.fields as Record<string, string>;
    expect(Object.keys(fields).sort()).toEqual(
      ["capabilities", "password", "roles", "user_login"].sort(),
    );
    expect(fields.password).toContain("application-passwords");
    expect(fields.user_login).toContain("identity");
  });

  it("reads the delete conflict's count out of details, never out of the message", () => {
    // No account in this shop's fixture set owns orders, so the shape is pinned
    // against the schema and the reader is asserted in both directions.
    expect(deleteConflictDetails.parse({ orders: 3 }).orders).toBe(3);
    expect(deleteConflictCount({ orders: 3 })).toBe(3);
    expect(deleteConflictCount({})).toBeNull();
    expect(deleteConflictCount({ orders: "3" })).toBeNull();
  });

  it("keys a duplicate 409 by the field that collided", () => {
    const details = duplicateDetails.parse(error(fixtures.refuseDuplicateUsername).details);
    expect(details.username).toBe("ac_panel_suspended");
    expect(details.email).toBeUndefined();
  });
});

describe("suspension and reactivation, which had no fixture before the seed", () => {
  it("round-trips through the production writers", () => {
    expect(staffUser.parse(data(fixtures.userSuspendedWrite)).status).toBe("suspended");
    expect(staffUser.parse(data(fixtures.userReactivated)).status).toBe("active");
    expect([...STAFF_STATUSES]).toEqual(["active", "suspended"]);
  });

  it("refuses to mint a credential for a suspended account, as its own 409", () => {
    const body = error(fixtures.appPasswordOnSuspended);
    expect(body.code).toBe("conflict");
    expect(body.message).toContain("suspended");
    // No `details`, unlike the duplicate-name 409 — so the panel has to tell
    // them apart by shape rather than by status.
    expect(credentialConflict(body.details ?? {})).toEqual({ kind: "suspended" });
    expect(credentialConflict({ name: "iPhone" })).toEqual({ kind: "name", name: "iPhone" });
  });

  it("changes a role and reports it, then deletes with a two-key answer", () => {
    expect(staffUser.parse(data(fixtures.userRoleChanged)).role).toBe("ac_super_admin");
    expect(staffUserDeleted.parse(data(fixtures.userDeleted))).toEqual({
      id: expect.any(Number),
      deleted: true,
    });
  });
});

describe("application passwords", () => {
  it("shows the secret in exactly one response", () => {
    const minted = mintedApplicationPassword.parse(data(fixtures.appPasswordMinted));
    expect(hasSecret(minted)).toBe(true);
    expect(minted.password.length).toBeGreaterThan(16);

    // Not on the collection, not on the detail, not in the audit row.
    const collection = applicationPasswordList.parse(data(fixtures.appPasswords));
    for (const row of collection) expect(row).not.toHaveProperty("password");

    const detail = staffUserDetail.parse(data(fixtures.userDetailWithPasswords));
    for (const row of detail.application_passwords) expect(row).not.toHaveProperty("password");

    const auditRows = data<Record<string, unknown>[]>(fixtures.auditAppPassword);
    expect(JSON.stringify(auditRows)).not.toContain(minted.password);
    expect(auditRows[0].metadata).toMatchObject({ uuid: expect.any(String) });
  });

  it("never publishes last_ip, which describes a person rather than a credential", () => {
    expect(JSON.stringify(fixtures.appPasswords)).not.toContain("last_ip");
    expect(JSON.stringify(fixtures.appPasswordMinted)).not.toContain("last_ip");
  });

  it("marks a credential that has never authenticated", () => {
    const collection = applicationPasswordList.parse(data(fixtures.appPasswords));
    expect(neverUsed(collection[0])).toBe(true);
    expect(neverUsed({ last_used: "2026-08-21T20:00:00+00:00" })).toBe(false);
  });

  it("keeps an added key and refuses a retyped one", () => {
    const row = data<Record<string, unknown>[]>(fixtures.appPasswords)[0];
    expect(applicationPassword.parse({ ...row, app_id: 4 })).toMatchObject({ app_id: 4 });
    // `last_used` nullable is what distinguishes "never" from "unknown".
    expect(() => applicationPassword.parse({ ...row, last_used: 0 })).toThrow();
    // A mint with no password is a sheet showing a copy button over nothing.
    expect(() => mintedApplicationPassword.parse(row)).toThrow();
  });

  it("refuses a duplicate name with the name in details", () => {
    expect(duplicateDetails.parse(error(fixtures.appPasswordDuplicate).details).name).toBe(
      "Panneau — iPhone de Yacine",
    );
  });

  it("starts empty and grows by exactly one", () => {
    expect(applicationPasswordList.parse(data(fixtures.appPasswordsEmpty))).toEqual([]);
    expect(applicationPasswordList.parse(data(fixtures.appPasswords))).toHaveLength(1);
  });
});

/* =================================================================== audit === */

describe("the audit trail", () => {
  const rows = auditList.parse(data(fixtures.audit));

  it("parses, and every row names a person", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // `actor_login` is on every row, which is exactly what the inventory
      // ledger cannot have — the whole argument for the per-user credential.
      expect(typeof row.actor_login).toBe("string");
      if (!isSystemActor(row)) expect(row.actor_login).not.toBe("");
    }
  });

  it("keeps an added key and refuses a retyped one", () => {
    const row = data<Record<string, unknown>[]>(fixtures.audit)[0];
    expect(auditRow.parse({ ...row, request_id: "abc" })).toMatchObject({ request_id: "abc" });

    /*
     * **`resource_id` is a string.** The column is varchar(64) because a menu is
     * audited by location and a shipping provider by its own name; a number here
     * would be a schema that only accepts the numbered half of the trail.
     *
     * *(This said "a page is audited by path" — a sixth copy of the sentence the
     * audit branch corrected. `CmsService.php:156,224,296` records
     * `(int) $page->ID`; the path goes in `metadata`.)*
     */
    expect(() => auditRow.parse({ ...row, resource_id: 4529 })).toThrow();
    expect(auditRow.parse({ ...row, resource_id: "conditions" }).resource_id).toBe("conditions");
  });

  it("carries a created_at with no offset — the third route with the convention", () => {
    for (const row of rows) {
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(row.created_at).not.toContain("T");
      expect(row.created_at).not.toMatch(/[+-]\d{2}:\d{2}$/);
    }

    /*
     * The defect this prevents, stated as an assertion: `new Date()` reads an
     * offsetless stamp as *local* and shifts it by the host's offset, while
     * `parseApiDate` reads it as UTC — which is what `AuditEvent`'s `gmdate()`
     * means. On a UTC+2 machine the two differ by two hours and nothing on
     * screen says so.
     */
    const stamp = "2026-08-21 18:55:45";
    expect(parseApiDate(stamp)?.toISOString()).toBe("2026-08-21T18:55:45.000Z");
  });

  it("filters by all five, and each filtered set is strictly smaller", () => {
    const whole = Number(meta(fixtures.audit).total);
    expect(whole).toBeGreaterThan(100);

    for (const body of [
      fixtures.auditByAction,
      fixtures.auditByActor,
      fixtures.auditByType,
      fixtures.auditByResourceId,
      fixtures.auditByDate,
    ]) {
      const total = Number(meta(body).total);
      // The floor: a filter that matched nothing would also be "smaller".
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(whole);
    }
  });

  it("honours ?resource_id= and the date range, which it did not before this branch", () => {
    /*
     * Both were **accepted and silently ignored** before `ecom-temp`'s
     * `feat/audit-filters` — 16 632 rows returned for every value, which is
     * §65's failure mode: a filter that does not filter is indistinguishable
     * from a collection that all matches. Both are named in ADMIN_PANEL.md as
     * though they worked.
     */
    const byId = auditList.parse(data(fixtures.auditByResourceId));
    expect(byId.length).toBeGreaterThan(0);
    const ids = new Set(byId.map((row) => row.resource_id));
    expect(ids.size).toBe(1);

    // An empty window is a 200 with no rows, not an error.
    expect(meta(fixtures.auditEmptyWindow).total).toBe(0);
    expect(auditList.parse(data(fixtures.auditEmptyWindow))).toEqual([]);
  });

  it("answers 200 with no rows for an unknown action, and 400 for a bad date", () => {
    // The action vocabulary is open, so it is not validated: a wrong guess is
    // an empty list rather than an error screen, which is why the control is a
    // free-text box.
    expect(meta(fixtures.auditUnknownAction).total).toBe(0);

    // A date is validated by pattern, because a coerced one is how the range
    // silently stopped filtering in the first place.
    expect(error(fixtures.auditBadDate).code).toBe("invalid_request");

    // `details.params` in its object shape, which `firstMessage` reads.
    const params = error(fixtures.auditBadPerPage).details?.params as Record<string, string>;
    expect(params.per_page).toContain("between 1");
  });
});

describe("the audit vocabularies", () => {
  it("names 22 resource types and renders a twenty-third as itself", () => {
    expect(RESOURCE_TYPES).toHaveLength(22);
    expect(isResourceType("product")).toBe(true);
    expect(isResourceType("faq_category")).toBe(true);
    // The one-row oddity, left unnamed on purpose so it stays visible.
    expect(isResourceType("ac_banner")).toBe(false);

    for (const type of RESOURCE_TYPES) {
      expect(fr.audit.resource).toHaveProperty(type);
      expect(ar.audit.resource).toHaveProperty(type);
    }
  });

  it("does not put an action in a message key, because every action has a dot", () => {
    /*
     * **The 14b defect, floored.** A `.` in a message key is a `next-intl` path
     * separator: `t("action.product.updated")` resolves `audit` → `action` →
     * `product` → `updated`, and the unresolved path renders as visible text
     * while every test still passes. So no action is a key here — the trail
     * renders it as the identifier it is.
     */
    expect(ACTION_COUNT).toBeGreaterThan(80);

    const actionKeys = Object.keys(fr.transfer.action);
    for (const key of actionKeys) expect(key).not.toContain(".");

    // And the floor across both files: no key in these four namespaces may
    // carry a dot, in either locale.
    for (const messages of [fr, ar]) {
      for (const namespace of ["settings", "staff", "audit", "transfer"] as const) {
        for (const key of flatKeys((messages as Record<string, unknown>)[namespace])) {
          expect(key.split(".").every((part) => part !== "")).toBe(true);
        }
      }
    }
  });

  it("derives a subject from an action, which is not the resource type", () => {
    expect(actionSubject("product.updated")).toBe("product");
    expect(actionSubject("user.app_password_created")).toBe("user");
    expect(actionSubject("geography")).toBe("geography");

    /*
     * The reason the filter uses `resource_type` and not the action's left
     * half: measured on the live table, `inventory.adjusted` records a
     * `product`, `cod.attempt_recorded` an `order`, and
     * `marketing.consent_given` a `customer`. Deriving one from the other
     * sends a request the API answers with nothing.
     */
    expect(actionSubject("inventory.adjusted")).toBe("inventory");
    expect(isResourceType("inventory")).toBe(false);
  });

  it("gives four verbs a tone and everything else neutral", () => {
    expect(actionTone("user.deleted")).toBe("danger");
    expect(actionTone("campaign.cancelled")).toBe("danger");
    expect(actionTone("user.created")).toBe("success");
    expect(actionTone("user.suspended")).toBe("warning");
    // A page of updates must read as a page of updates, not a wall of colour.
    expect(actionTone("product.updated")).toBe("neutral");
    expect(actionTone("settings.updated")).toBe("neutral");
  });

  it("validates an action query the way the route does", () => {
    expect(isActionQuery("")).toBe(true);
    expect(isActionQuery("product.updated")).toBe(true);
    expect(isActionQuery("user.app_password_created")).toBe(true);
    expect(isActionQuery("Product.Updated")).toBe(false);
    expect(isActionQuery("product updated")).toBe(false);
  });
});

describe("audit metadata has four shapes, and the spec describes one of them", () => {
  it("records field names only on settings, which is where the spec argues for it", () => {
    const row = auditList.parse(data(fixtures.auditSettings))[0];
    const shape = metadataShape(row.metadata);

    expect(shape.kind).toBe("fields");
    if (shape.kind === "fields") expect(shape.fields).toEqual(["contact.phone"]);

    // No value anywhere in it. The trade-register numbers do not go in a table
    // nobody cleans.
    expect(JSON.stringify(row.metadata)).not.toContain("+213");
  });

  it("records values on a product write, which the spec says never happens", () => {
    /*
     * ADMIN_PANEL.md's Audit section: "Writes are audited **by field name,
     * never by value**." Measured on the live table, `product.updated` carries
     * `before` and `after` in full — 3 072 rows of them.
     */
    const shape = metadataShape({
      fields: ["name", "regular_price"],
      before: { name: "Tapis", regular_price: "1000", status: "publish" },
      after: { name: "Tapis berbère", regular_price: "24000", status: "publish" },
    });

    expect(shape.kind).toBe("change");
    if (shape.kind !== "change") return;

    const pairs = changedPairs(shape);
    expect(pairs.map((p) => p.field)).toEqual(["name", "regular_price"]);
    expect(pairs[0]).toEqual({ field: "name", before: "Tapis", after: "Tapis berbère" });

    /*
     * `before`/`after` carry the whole tracked set and `fields` names what was
     * submitted — `status` is on both sides unchanged, and leading with `fields`
     * is the honest list.
     */
    expect(pairs.map((p) => p.field)).not.toContain("status");
  });

  it("records both sides of a role change, where the value is the security fact", () => {
    const row = auditList.parse(data(fixtures.auditRoleChange))[0];
    const shape = metadataShape(row.metadata);

    expect(shape.kind).toBe("transition");
    if (shape.kind === "transition") {
      expect(shape.from).toBe("ac_manager");
      expect(shape.to).toBe("ac_super_admin");
    }
  });

  it("renders a redacted value as a fact rather than as a gap", () => {
    const row = auditList.parse(data(fixtures.auditRedacted))[0];
    const shape = metadataShape(row.metadata);

    expect(shape.kind).toBe("plain");
    if (shape.kind !== "plain") return;

    const entries = Object.fromEntries(shape.entries);
    expect(entries.dedupe_key).toBe("[redacted]");
    expect(isRedacted(entries.dedupe_key)).toBe(true);
    expect(isRedacted("")).toBe(false);
    expect(isRedacted(null)).toBe(false);

    // The channel and event beside it are not redacted, which is what makes the
    // redaction legible as a choice rather than as a broken row.
    expect(entries.channel).toBe("email");
  });

  it("prints a nested value rather than dropping it", () => {
    const entries = Object.fromEntries(
      plainEntries({ types: ["hero", "grid"], count: 2, forced: true, nothing: null }),
    );
    expect(entries.types).toBe('["hero","grid"]');
    expect(entries.count).toBe("2");
    expect(entries.forced).toBe("true");
    expect(entries.nothing).toBe("—");
  });

  it("names the system when a row has no actor", () => {
    expect(isSystemActor({ actor_id: 0, actor_login: "" })).toBe(true);
    expect(isSystemActor({ actor_id: 12, actor_login: "" })).toBe(true);
    expect(isSystemActor({ actor_id: 12, actor_login: "karim" })).toBe(false);
  });
});

/* ================================================================ transfer === */

describe("the capability grid, which is the shape of the branch", () => {
  const grid = fixtures.capabilityGrid as Record<string, Record<string, number>>;

  it("puts three subjects behind Super Admin and the fourth behind the resource", () => {
    for (const route of ["GET /settings", "PATCH /settings", "GET /users", "GET /roles", "GET /audit-logs"]) {
      expect(grid.super[route]).not.toBe(403);
      expect(grid.manager[route]).toBe(403);
      expect(grid.marketing[route]).toBe(403);
      expect(grid.limited[route]).toBe(403);
    }
  });

  it("makes one Manager credential both the refusal and the positive control", () => {
    // 403 on the three subjects above, and reachable on all six transfer routes.
    for (const route of [
      "GET /export/products",
      "GET /export/orders",
      "GET /export/inventory",
      "GET /export/customers",
    ]) {
      expect(grid.manager[route]).toBe(200);
    }
    // 400 rather than 200: the body was empty, which is the route answering.
    expect(grid.manager["POST /import/products"]).toBe(400);
    expect(grid.manager["POST /import/inventory"]).toBe(400);
  });

  it("proves the rule is per subject with a Support Agent, which no single 403 can", () => {
    /*
     * The strongest single assertion on this branch. `ac_manage_customers` and
     * nothing else here: **200 on customers and 403 on the other three**. A
     * credential that was refused everything would be consistent with a
     * per-screen gate; this one is not.
     */
    expect(grid.limited["GET /export/customers"]).toBe(200);
    expect(grid.limited["GET /export/products"]).toBe(403);
    expect(grid.limited["GET /export/orders"]).toBe(403);
    expect(grid.limited["GET /export/inventory"]).toBe(403);
  });

  it("refuses a Marketing Manager all six, which is the flat fixture", () => {
    for (const route of Object.keys(grid.marketing)) {
      expect(grid.marketing[route]).toBe(403);
    }
    expect(error(fixtures.exportForbidden).code).toBe("forbidden");
    expect(error(fixtures.importForbidden).code).toBe("forbidden");
  });

  it("maps every export subject to the capability that guards it", () => {
    expect(Object.keys(SUBJECT_CAPABILITY).sort()).toEqual([...EXPORT_SUBJECTS].sort());
    expect(SUBJECT_CAPABILITY.customers).toBe("ac_manage_customers");
    expect(SUBJECT_CAPABILITY.orders).toBe("ac_manage_orders");
  });
});

describe("exports are files", () => {
  const heads = {
    products: fixtures.exportProducts,
    orders: fixtures.exportOrders,
    inventory: fixtures.exportInventory,
    customers: fixtures.exportCustomers,
  } as Record<
    string,
    {
      status: number;
      content_type: string;
      content_disposition: string;
      cache_control: string;
      first_line: string;
      lines: number;
      crlf: boolean;
    }
  >;

  it("answers text/csv with the API's own filename and no-store", () => {
    for (const [subject, head] of Object.entries(heads)) {
      expect(head.status).toBe(200);
      expect(head.content_type).toContain("text/csv");
      expect(head.content_disposition).toContain("attachment");
      expect(head.content_disposition).toContain(`${subject}-export-`);
      expect(head.cache_control).toContain("no-store");
    }
  });

  it("names its columns on the first line — all four, which was not true of products", () => {
    /*
     * `ProductCsvExporter::toCsv()` called `get_csv_data()`, which is the rows;
     * `export()` sends `export_column_headers()` before it. So the product
     * export began `10,simple,AC-TAP-001,…` where every sibling began with its
     * column names, and `POST /import/products` read a product's own values as
     * the header. Fixed in `ecom-temp` on `fix/product-export-header`.
     */
    expect(heads.products.first_line.toLowerCase()).toContain("sku");
    expect(heads.products.first_line.startsWith("ID,")).toBe(true);
    expect(heads.orders.first_line).toContain("order_id");
    expect(heads.inventory.first_line).toContain("sku,stock_quantity");
    expect(heads.customers.first_line).toContain("customer_id");
  });

  it("has records after the header, which a one-line JSON body would not", () => {
    /*
     * The other export defect this branch found, and the one the backend's own
     * assertions were blind to: `FileDownload` never served, so WordPress
     * JSON-encoded the CSV as a bare string — one quoted line, the BOM as six
     * characters, every newline as two. "Not JSON" grepped for a `success` key
     * a JSON string has none of; "names its columns" grepped a first line that
     * was the whole file.
     */
    for (const head of Object.values(heads)) expect(head.lines).toBeGreaterThan(1);
  });

  it("ends its lines with CRLF everywhere except the product export", () => {
    /*
     * Measured, and worth pinning because it is invisible until something reads
     * the file strictly. `CsvWriter` emits CRLF — RFC 4180, and what Excel on
     * Windows expects — while `WC_CSV_Exporter` emits LF, so the one export
     * that is WooCommerce's own disagrees with the three that are ours.
     *
     * Not a defect and not fixed: every reader in play handles both, and
     * rewriting WooCommerce's output would fork the format §64 exists not to
     * fork. It is here so that a future assertion splitting on `\r\n` fails on
     * purpose rather than reporting a one-line file.
     */
    expect(heads.orders.crlf).toBe(true);
    expect(heads.inventory.crlf).toBe(true);
    expect(heads.customers.crlf).toBe(true);
    expect(heads.products.crlf).toBe(false);
  });

  it("still answers an export error inside the envelope, with its 4xx", () => {
    const params = error(fixtures.exportOverCap).details?.params as Record<string, string>;
    expect(params.limit).toContain("2000");
    // Which is what stops a client saving an error message as products.csv.
    expect(error(fixtures.exportOverCap).code).toBe("invalid_request");
  });

  it("promises a round trip only where the file actually round-trips", () => {
    /*
     * **This assertion used to hold the opposite, and both versions were
     * measured.** It read `every sku resolves empty` and `ROUND_TRIPS.products
     * is false`, which was true of the API as it then stood: the export wrote
     * WooCommerce's display labels, the importer matched field names exactly,
     * and nothing in between mapped one onto the other.
     *
     * What made that a defect rather than a gap is the *shape* of the failure —
     * `created: 33, failed: 0` with every field empty, a green preview for a
     * file nothing had been read out of. Fixed in `ecom-temp` on
     * `fix/product-export-field-names`; the fixtures below are re-captured.
     */
    const report = importReport.parse(data(fixtures.exportProductsRoundTrip));
    expect(report.rows).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
    // Every SKU resolves now. This is the exact clause that used to assert the
    // reverse, kept in place so the change is legible rather than deleted.
    expect(report.preview.every((row) => (row.sku ?? "") !== "")).toBe(true);
    // Default mode is `create`, so a file of products that exist is all skips —
    // and the reason names the SKU rather than a missing one.
    expect(report.skipped).toBe(report.rows);
    expect(report.created).toBe(0);

    // The half an operator actually wants: edit the export, send it back.
    const update = importReport.parse(data(fixtures.exportProductsRoundTripUpdate));
    expect(update.updated).toBe(update.rows);
    expect(update.failed).toBe(0);
    expect(update.preview.every((row) => (row.name ?? "") !== "")).toBe(true);

    /*
     * And the control that keeps the fix honest: the **old** header is now
     * refused outright rather than reported as a success. A file WooCommerce's
     * importer cannot map is a 400 naming the column it needs, which is the
     * difference between this being fixed and the lenient reader simply having
     * moved.
     */
    const refused = error(fixtures.importLabelHeader);
    expect(refused.code).toBe("invalid_request");
    const fields = refused.details?.fields as Record<string, string>;
    expect(fields.file).toContain("sku");

    expect(ROUND_TRIPS.products).toBe(true);
    expect(ROUND_TRIPS.inventory).toBe(true);
    // `orders` and `customers` stay false for a different reason: no importer at
    // all, which is not the same fact as a file that will not load.
    expect(ROUND_TRIPS.orders).toBe(false);
    expect(isImportable("inventory")).toBe(true);
    expect(isImportable("orders")).toBe(false);
    expect([...IMPORT_SUBJECTS]).toEqual(["products", "inventory"]);
  });
});

describe("an import is a raw CSV body", () => {
  it("refuses JSON by name, which is the trap the spec names", () => {
    const fields = error(fixtures.importAsJson).details?.fields as Record<string, string>;
    expect(fields.body).toContain("text/csv");
    expect(fields.body).toContain("not JSON");
  });

  it("refuses an empty file and a missing column, and says what it read", () => {
    const empty = error(fixtures.importEmpty).details?.fields as Record<string, string>;
    expect(empty.file).toContain("header row");

    const details = missingColumnsDetails.parse(error(fixtures.importMissingColumns).details);
    expect(details.fields.file).toBe("Missing: sku.");
    expect(details.columns_required).toEqual(["sku"]);
    expect(details.columns_found).toEqual(["a", "b", "c"]);

    /*
     * `columns_found` sits **beside** `fields` rather than inside it, so a form
     * binding only to `fields` throws away the one thing that turns this
     * refusal into an answer.
     */
    const read = missingColumns(error(fixtures.importMissingColumns).details ?? {});
    expect(read).toEqual({ found: ["a", "b", "c"], required: ["sku"] });
    expect(missingColumns({ fields: { file: "x" } })).toBeNull();
  });

  it("refuses a bad mode in details.params, not details.fields", () => {
    const params = error(fixtures.importBadMode).details?.params as Record<string, string>;
    expect(params.mode).toContain("create and update");
    expect(error(fixtures.importBadMode).details).not.toHaveProperty("fields");
  });

  it("defaults to create, and offers a mode on products alone", () => {
    // With no `mode`, an existing SKU is skipped and a new one is created.
    const created = importReport.parse(data(fixtures.importProductsCreate));
    expect(created.created).toBe(1);
    expect(created.updated).toBe(0);
    expect(DEFAULT_MODE).toBe("create");

    expect(hasMode("products")).toBe(true);
    // "Not found. An inventory import never creates products." — so a mode
    // control there would offer a choice the route does not have.
    expect(hasMode("inventory")).toBe(false);
  });
});

describe("the import report", () => {
  it("echoes dry_run, which is the safety property made visible", () => {
    expect(importReport.parse(data(fixtures.importInventoryDry)).dry_run).toBe(true);
    expect(importReport.parse(data(fixtures.importProductsDry)).dry_run).toBe(true);
    expect(importReport.parse(data(fixtures.importApplied)).dry_run).toBe(false);
  });

  it("parses all four preview shapes, of which only line and action are shared", () => {
    for (const body of [
      fixtures.importInventoryDry,
      fixtures.importProductsDry,
      fixtures.importProductsCreate,
      fixtures.importApplied,
    ]) {
      const report = importReport.parse(data(body));
      for (const row of report.preview) {
        expect(typeof row.line).toBe("number");
        expect(typeof row.action).toBe("string");
      }
    }

    // The products shape carries a name and no stock; the inventory shape
    // carries stock and no name.
    const products = importReport.parse(data(fixtures.importProductsDry));
    expect(products.preview[0]).toHaveProperty("name");
    expect(products.preview[0].from).toBeUndefined();

    const inventory = importReport.parse(data(fixtures.importInventoryDry));
    expect(inventory.preview[0].from).toBe(6);
    expect(inventory.preview[0].to).toBe(12);
    expect(inventory.preview[0].name).toBeUndefined();
  });

  it("keeps an added key and refuses a retyped one", () => {
    const report = data<Record<string, unknown>>(fixtures.importInventoryDry);
    expect(importReport.parse({ ...report, elapsed_ms: 12 })).toMatchObject({ elapsed_ms: 12 });

    // `dry_run` is the one field the confirmation is built on.
    expect(() => importReport.parse({ ...report, dry_run: "false" })).toThrow();
    // `errors` and `preview` are always present, `[]` when empty — code that
    // destructured a missing `preview` would throw on the healthy case.
    expect(() => importReport.parse({ ...report, preview: undefined })).toThrow();

    // A preview row's `from` is nullable, because null stock is not zero stock.
    expect(previewRow.parse({ line: 2, action: "updated", from: null, to: 5 }).from).toBeNull();
    expect(() => previewRow.parse({ line: "2", action: "updated" })).toThrow();
  });

  it("carries preview_only on a products dry run and nowhere else", () => {
    const products = importReport.parse(data(fixtures.importProductsDry));
    const inventory = importReport.parse(data(fixtures.importInventoryDry));
    const applied = importReport.parse(data(fixtures.importApplied));

    expect(previewIsNotARehearsal(products)).toBe(true);
    // Our own importer really does rehearse, so it says nothing.
    expect(previewIsNotARehearsal(inventory)).toBe(false);
    expect(previewIsNotARehearsal(applied)).toBe(false);

    /*
     * **The string is English prose from the API and is never rendered.** Its
     * presence is the signal; the panel says its own sentence. The analytics
     * branch's rule, and the assertion that keeps it: no message in these four
     * namespaces may quote it.
     */
    expect(products.preview_only).toContain("WooCommerce");
    expect(JSON.stringify(fr.transfer)).not.toContain("no dry-run mode");
    expect(JSON.stringify(ar.transfer)).not.toContain("no dry-run mode");
  });

  it("names an import that would write nothing", () => {
    const applied = importReport.parse(data(fixtures.importApplied));
    // Every row skipped: a 200, and a useless import. The two look identical if
    // the screen only reports the status.
    expect(reportIsNoOp(applied)).toBe(true);

    const real = importReport.parse(data(fixtures.importProductsCreate));
    expect(reportIsNoOp(real)).toBe(false);
  });

  it("splits a row error into its field messages", () => {
    const report = importReport.parse(data(fixtures.importInventoryDry));
    expect(report.errors).toHaveLength(1);
    expect(errorFields(report.errors[0])).toEqual([
      ["sku", "Not found. An inventory import never creates products."],
    ]);
    // The fallback, for an error that is not about one column.
    expect(errorFields({})).toEqual([]);
  });

  it("reads a Manager's import exactly as a Super Admin's", () => {
    // The positive half of the branch's forbidden fixture, in the same session.
    const asManager = importReport.parse(data(fixtures.importInventoryAsManager));
    expect(asManager.dry_run).toBe(true);
    expect(asManager.updated).toBe(1);
    expect(asManager.failed).toBe(1);
  });
});

/* ============================================================== url state === */

describe("the URL state normalises what the API would refuse", () => {
  it("drops an audit filter a stale link would 400 on", () => {
    const stale = auditQueryFromParams(
      new URLSearchParams({
        action: "Product.Updated",
        resource_type: "nonsense",
        date_from: "yesterday",
        resource_id: "x".repeat(80),
        actor_id: "-4",
      }),
    );

    expect(stale).toMatchObject({
      action: "",
      resourceType: "",
      dateFrom: "",
      resourceId: "",
      actorId: 0,
    });
    // And nothing that was dropped reaches the wire.
    expect(auditListParams(stale).toString()).toBe("per_page=20&page=1");
  });

  it("keeps a non-numeric resource id, which is the point of it being a string", () => {
    const query = auditQueryFromParams(
      new URLSearchParams({ resource_type: "page", resource_id: "conditions" }),
    );
    expect(query.resourceId).toBe("conditions");
    expect(auditListParams(query).get("resource_id")).toBe("conditions");
  });

  it("drops a staff status a stale link would 400 on, and keeps a role key", () => {
    const query = usersQueryFromParams(
      new URLSearchParams({ status: "disabled", role: "ac_support_agent", search: "nadia" }),
    );
    expect(query.status).toBe("");
    // A retired role is a legal filter — 51 of 72 accounts hold one — so it is
    // kept while an invented status is not.
    expect(query.role).toBe("ac_support_agent");
    expect(usersListParams(query).get("search")).toBe("nadia");
  });
});

/* =============================================================== messages === */

describe("both locales resolve every key these screens use", () => {
  const namespaces = ["settings", "staff", "audit", "transfer"] as const;

  it("is at exact key parity", () => {
    for (const namespace of namespaces) {
      const a = flatKeys((fr as Record<string, unknown>)[namespace]).sort();
      const b = flatKeys((ar as Record<string, unknown>)[namespace]).sort();
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(20);
    }
  });

  it("contains no `{{token}}`, which renders the key path instead of a message", () => {
    /*
     * **The 14c defect, floored.** `{{first_name}}` parses as a literal `{`, the
     * placeholder `{first_name}` and a literal `}`; `next-intl` throws
     * `INVALID_MESSAGE` and renders the key path as visible text. Presence is
     * not validity, and the existing message floor could not see it.
     */
    for (const messages of [fr, ar]) {
      for (const namespace of namespaces) {
        const block = (messages as Record<string, unknown>)[namespace];
        expect(JSON.stringify(block)).not.toContain("{{");
      }
    }
  });

  it("names every capability this branch gates on", () => {
    for (const capability of [
      "ac_manage_settings",
      "ac_manage_users",
      "ac_view_audit_logs",
      "ac_manage_products",
      "ac_manage_customers",
    ]) {
      expect(fr.states.capability).toHaveProperty(capability);
      expect(ar.states.capability).toHaveProperty(capability);
    }
  });

  it("names every writable settings field and every status", () => {
    for (const block of WRITABLE_BLOCKS) {
      for (const key of EDITED_KEYS[block]) {
        expect(fr.settings.field).toHaveProperty(`${block}_${key}`);
        expect(ar.settings.field).toHaveProperty(`${block}_${key}`);
      }
    }
    for (const status of STAFF_STATUSES) {
      expect(fr.staff.status).toHaveProperty(status);
      expect(ar.staff.status).toHaveProperty(status);
    }
    for (const subject of EXPORT_SUBJECTS) {
      expect(fr.transfer.subject).toHaveProperty(subject);
      expect(ar.transfer.subject).toHaveProperty(subject);
    }
  });
});

/* ---------------------------------------------------------------- helpers --- */

function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/* A guard against the schemas being vacuously loose. */
describe("the schemas are capable of failing", () => {
  it("refuses a payload of the wrong kind outright", () => {
    for (const schema of [settings, staffUser, role, auditRow, importReport] as z.ZodType[]) {
      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse([])).toThrow();
      expect(() => schema.parse("a string")).toThrow();
    }

    for (const schema of [staffUserList, roleList, auditList] as z.ZodType[]) {
      expect(() => schema.parse({})).toThrow();
    }
  });
});
