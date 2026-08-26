import "@testing-library/jest-dom/vitest";

// The seal is exercised by the unit suite, so it needs a key. Any 32+ characters
// will do — the test asserts the round trip, not the secret.
process.env.SESSION_SECRET = "test-secret-that-is-long-enough-to-pass";

/*
 * jsdom has never implemented `IntersectionObserver`, and `Scaffold` uses one to
 * collapse its large title — deliberately, because a scroll listener recomputing
 * layout at 60 Hz janks the list under the reader's thumb.
 *
 * A no-op stub rather than a polyfill: nothing in the unit suite scrolls, so the
 * only behaviour needed is that constructing one does not throw. The *collapse*
 * is a scroll behaviour and belongs to the e2e suite, which runs in a real engine
 * that has the API.
 */
/*
 * jsdom implements no layout, so it implements no `Element.scrollIntoView` —
 * it is not a gap in the component that calls one. `FilterTabs` keeps the active
 * tab in view when a filter is restored from a URL, because at 340px "Refunded"
 * is well off the end of the strip and landing on a filtered link that appears
 * to have nothing selected is confusing.
 *
 * A no-op rather than a guard inside the primitive: `scrollIntoView` is on every
 * engine this panel ships to, and a `typeof … === "function"` check in the
 * component would be defensive code for a browser that does not exist. Guarded
 * on `Element` because the suite's node-environment files have no DOM at all.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!("IntersectionObserver" in globalThis)) {
  class NoopIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = NoopIntersectionObserver;
}
