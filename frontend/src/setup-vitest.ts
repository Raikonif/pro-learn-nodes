import '@testing-library/jest-dom'

// React Flow observes its viewport and node layers. jsdom has no layout
// engine, so a no-op observer keeps component tests deterministic while still
// allowing React Flow to mount its real interaction surface.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}

    observe(_target: Element): void {}

    unobserve(): void {}
    disconnect(): void {}
  }
}
