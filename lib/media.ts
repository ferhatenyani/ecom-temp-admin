/**
 * The media library's rules, and the five ways an upload fails.
 *
 * ADMIN_PANEL.md's Media section says "**413** for size and **415** for type,
 * and both need distinct messages". Measured against the live API on
 * 2026-08-21, that is two of five, and the two it names are the two that need
 * the least explaining.
 *
 * The measurement took a correction of its own to get right, which is the
 * reason it is written down here in full. A PDF renamed `.png` answered **400
 * "The uploaded file is empty or truncated."** — apparently a third code for a
 * disguised file. It was not: the fake PDF was 48 bytes and `UploadPolicy`
 * checks `MIN_BYTES = 64` *before* it sniffs anything, so the size floor fired
 * and the sniffer never ran. With a 5.4 KB control the same file answers 415
 * with `details.detected: "application/pdf"`. Every negative test carries a
 * positive control, and this is what happens when one nearly does not.
 *
 *   < 64 bytes            400  invalid_upload           {size}
 *   > 8 MiB               413  file_too_large           {size, max_bytes}
 *   bad extension         415  unsupported_media_type   {extension}
 *   not an image at all   415  unsupported_media_type   {detected}
 *   extension ≠ contents  415  unsupported_media_type   {extension, detected}
 *   hostile filename      400  invalid_upload           —
 *
 * The fifth is the one worth separating from the third, and neither the spec
 * nor a naive reading of the status code would. "Only jpg, png and webp are
 * accepted" tells someone who picked a `.gif` exactly what to do. It tells
 * someone who renamed a JPEG to `.png` something that looks false — their file
 * *is* a `.png` as far as they can see — when the fix is to re-export it rather
 * than to pick a different one.
 */

/** `ACCEPTED_TYPES` on the API, which is narrower than the extensions it takes. */
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** `ALLOWED_EXTENSIONS`. Four extensions, three types — `jpg` and `jpeg` both map to JPEG. */
export const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** The `accept` attribute for the file input. Advisory only; the server decides. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME.join(",");

/**
 * `UploadPolicy::DEFAULT_MAX_BYTES` — 8 MiB, and `MIN_BYTES` — 64.
 *
 * Both are checked client-side **and** treated as advisory. A phone on mobile
 * data should not spend forty seconds uploading a file that will be refused, and
 * the panel must still render the server's answer as the authority: the cap is
 * raisable with `AC_MEDIA_MAX_BYTES` and PHP's own limit can be lower than
 * either, so a client that trusted its own arithmetic would be wrong in both
 * directions.
 */
export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_BYTES = 64;

export type UploadRefusal =
  | { kind: "too_small"; size: number }
  | { kind: "too_large"; size: number; maxBytes: number }
  | { kind: "bad_extension"; extension: string }
  | { kind: "not_an_image"; detected: string }
  | { kind: "contents_disagree"; extension: string; detected: string }
  | { kind: "bad_filename" }
  | { kind: "other"; message: string };

/**
 * What the panel can tell before spending the upload.
 *
 * Deliberately only the two facts a browser actually has — the byte length and
 * the name. It does **not** sniff: `File.type` is the operating system's guess
 * from the extension, so checking it would refuse nothing the extension check
 * does not already refuse and would wrongly refuse a correctly-named file whose
 * type the OS has no mapping for.
 */
export function precheck(file: { name: string; size: number }): UploadRefusal | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (!file.name.includes(".") || extension === "") {
    return { kind: "bad_filename" };
  }
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { kind: "bad_extension", extension };
  }
  if (file.size < MIN_BYTES) {
    return { kind: "too_small", size: file.size };
  }
  if (file.size > MAX_BYTES) {
    return { kind: "too_large", size: file.size, maxBytes: MAX_BYTES };
  }

  return null;
}

/**
 * The server's answer, classified.
 *
 * Keyed on `code` and `details` rather than on the message, because the message
 * is English prose that the API is free to reword and the panel renders in
 * French and Arabic. `details` is what carries the distinguishing fact — and for
 * the two 415s that share a code, `details` is the *only* thing that separates
 * them.
 */
export function classifyRefusal(
  status: number,
  code: string | undefined,
  details: Record<string, unknown>,
  message: string,
): UploadRefusal {
  const extension = typeof details.extension === "string" ? details.extension : null;
  const detected = typeof details.detected === "string" ? details.detected : null;
  const size = typeof details.size === "number" ? details.size : null;

  if (status === 413 || code === "file_too_large") {
    return {
      kind: "too_large",
      size: size ?? 0,
      maxBytes: typeof details.max_bytes === "number" ? details.max_bytes : MAX_BYTES,
    };
  }

  if (code === "unsupported_media_type") {
    /*
     * Both facts present means the file *is* an image and *is* one of the
     * accepted types — it is simply not the type its name claims. That is a
     * different problem with a different fix, and it is the whole reason this
     * function exists rather than a switch on the status code.
     */
    if (extension !== null && detected !== null) {
      return { kind: "contents_disagree", extension, detected };
    }
    if (detected !== null) return { kind: "not_an_image", detected };
    if (extension !== null) return { kind: "bad_extension", extension };
  }

  if (code === "invalid_upload") {
    if (size !== null) return { kind: "too_small", size };
    return { kind: "bad_filename" };
  }

  return { kind: "other", message };
}

/**
 * A byte count for a person, in the reader's locale.
 *
 * `Intl.NumberFormat` rather than a hand-rolled `toFixed`, so the decimal
 * separator is a comma in French and the digits are whatever the Arabic locale
 * asks for. The unit is not translated — `Mo` and `Ko` are the French forms and
 * the Arabic locale renders the abbreviation the same way the rest of this panel
 * renders `DA`.
 */
export function formatBytes(bytes: number, locale: string): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value);

  if (bytes >= 1024 * 1024) return `${format(bytes / (1024 * 1024), 1)} Mo`;
  if (bytes >= 1024) return `${format(bytes / 1024, 0)} Ko`;
  return `${format(bytes, 0)} o`;
}

/**
 * Upload with a progress figure, which means `XMLHttpRequest`.
 *
 * `fetch` cannot report upload progress — `ReadableStream` request bodies are
 * not supported for uploads on Safari and duplex streaming is not a thing on any
 * mobile browser this panel targets. ADMIN_PANEL.md is explicit that this is the
 * one screen where a spinner without a percentage is unacceptable on a 3G
 * connection, so the older API is the correct one and this is the only place in
 * the panel that uses it.
 *
 * The request goes through `/api/ac/media` like every other call, so the
 * credential is attached by the Route Handler and never reaches the browser.
 * `multipart/form-data` with the field named `file` — and the boundary is left
 * to the browser, because setting `Content-Type` by hand omits it and the API
 * then parses no file at all.
 */
export function uploadWithProgress(
  file: File,
  fields: { alt?: string; title?: string; caption?: string },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== "") form.append(key, value);
    }

    const request = new XMLHttpRequest();
    request.open("POST", "/api/ac/media");
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      // `lengthComputable` is false on some proxies. Reporting a fraction of an
      // unknown total is how a progress bar reaches 100% and then waits.
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });

    /*
     * The upload finishing is not the request finishing. The bytes leave, then
     * the API sniffs the file, writes it and builds the response — which on a
     * large image is a visible pause. Holding the bar at 100% through that is
     * honest about the upload and dishonest about the wait, so the caller is
     * told the bytes are gone and shows an indeterminate state after.
     */
    request.upload.addEventListener("load", () => onProgress(1));

    request.addEventListener("load", () =>
      resolve({ status: request.status, body: request.responseText }),
    );
    request.addEventListener("error", () =>
      reject(new Error("The upload could not be sent.")),
    );
    request.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));

    signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(form);
  });
}
