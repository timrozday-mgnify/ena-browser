// jsdom has neither observer API; Handsontable's stretchColumns plugin and its
// visibility check both need one. Stubs are enough — jsdom lays nothing out.
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

for (const name of ["ResizeObserver", "IntersectionObserver"]) {
  if (!(name in globalThis)) {
    (globalThis as Record<string, unknown>)[name] = NoopObserver;
  }
}
