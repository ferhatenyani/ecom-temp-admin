import "@testing-library/jest-dom/vitest";

// The seal is exercised by the unit suite, so it needs a key. Any 32+ characters
// will do — the test asserts the round trip, not the secret.
process.env.SESSION_SECRET = "test-secret-that-is-long-enough-to-pass";

/*
 * jsdom has never implemented `IntersectionObserver`. This stub was added for
 * `Scaffold`, which drove one to collapse its large title.
 *
 * **`Scaffold` was deleted at teardown, and no component observes anything
 * today** — `PageHeader` replaced the collapsing title with a static one, which
 * is the whole reason the class is gone. The stub is therefore currently unused.
 * It is kept rather than deleted because it costs one construction guard and
 * because the next component that needs an observer would otherwise fail in
 * jsdom for a reason that has nothing to do with it — but it is a stub with no
 * consumer, and if that is not wanted, this is the block to remove.
 *
 * A no-op rather than a polyfill: nothing in the unit suite scrolls, so the only
 * behaviour needed is that constructing one does not throw.
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

/*
 * The three jsdom gaps a Radix popper falls into, added when `Listbox` replaced
 * the last native `<select>` in the panel.
 *
 * None of them is a shortcoming of the component. `ResizeObserver` is what
 * Floating UI watches the trigger with, and the pointer-capture pair is what
 * Radix's own press handling calls before it decides whether a pointerdown
 * became a drag. jsdom implements no layout and no pointer events, so all three
 * are simply absent — a component that guarded against their absence would be
 * carrying defensive code for a browser that does not exist.
 *
 * The observer is a no-op rather than a measuring stub for the same reason the
 * `IntersectionObserver` below is: nothing in the unit suite has a layout to
 * observe, so the only behaviour needed is that constructing one does not throw.
 */
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
}

if (!("ResizeObserver" in globalThis)) {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver;
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
