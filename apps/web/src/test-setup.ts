import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither of these, and the graph view uses both: a
 * ResizeObserver to keep the canvas sized to its container, and a 2D context
 * to draw into. Stubbing them keeps the component's *behaviour* testable —
 * selection, the entity list, the connections panel — while the drawing
 * itself is verified in a real browser instead.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub;

// jsdom *defines* getContext but logs "Not implemented" and returns null, so
// this is an unconditional override rather than a fallback. `draw()` already
// treats a null context as "nothing to paint".
HTMLCanvasElement.prototype.getContext = (() => null) as never;
