# ena-browser

A reusable browser **element** for viewing, filtering and (optionally) editing
**ENA Webin report records** — studies, samples, runs, experiments, analyses and
files — in a Handsontable grid.

It is a *view*, not an application. It renders rows, lets the user filter, sort,
pin, reorder and select them, tracks edits, and hands the result back to whoever
embedded it. It never talks to ENA's submission API and never builds a manifest;
that stays in [`ena-submission-toolkit`](https://github.com/timrozday-mgnify/ena-submission-toolkit)
and its callers.

Three uses drive the design:

1. **Post-submission confirmation** — show that just-submitted records are
   present in ENA (read-only).
2. **Read↔sample pairing** — provide the *samples* side of a pairing UI:
   selection events plus a pinned, live-updating "reads assigned" column that
   the host app writes into.
3. **Free browsing / editing** — the assistant's *Records* tab: filter and sort
   everything, include or exclude cancelled/suppressed records, edit cells, and
   emit a change set the host turns into an ENA MODIFY submission.

Status: **design only.** No code yet — see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
for the step-by-step build.

---

## 1. Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Grid | **Handsontable 17.x** (`handsontable`, non-commercial licence, same pin as the rest of the ecosystem) | Already the grid everywhere else here (DataHarmonizer, dhtb). Its `Filters`, `MultiColumnSorting`, `DropdownMenu`, `ManualColumnMove`, `HiddenColumns` and `fixedColumnsStart` plugins cover filtering, sorting, reordering and pinning without writing any of it. |
| Language | **TypeScript**, strict | Matches dhtb. The public API is a contract that several projects code against; types are the documentation. |
| Component model | **Native custom element** `<ena-browser>` (no framework) | The assistant is vanilla JS with no npm build step; dhtb is React. A custom element is usable verbatim from both, from plain HTML, and from an iframe. No React/Vue dependency is added anywhere. |
| Shadow DOM | **No** — light DOM with a `.ena-browser` class prefix | Handsontable's overlays, dropdown menus and `document`-level event handling fight Shadow DOM. Theming via CSS custom properties instead (see §5). |
| Build | **Vite library mode** → three artefacts (§2) | dhtb already uses Vite 6. Library mode gives an ESM build for npm-ish consumers and a self-contained IIFE for the assistant's `<script src>` world. |
| Tests | **Vitest** (pure logic) + **Playwright** (grid behaviour against the demo page) | Mirrors the ecosystem: dhtb has `playwright.config.ts`, the assistant has Playwright UI tests. |
| Data access | **Transport-agnostic core** + one optional adapter | The core takes rows or an async fetcher. `src/sources/enaReports.ts` is an *optional* adapter that calls the Webin Reports API directly with Basic auth — it exists so the standalone app works with no backend; the assistant ignores it and passes rows from its own API. |
| Package name | `ena-browser`, repo `timrozday-mgnify/ena-browser`, consumed at a **git tag** | Same pinning strategy as every other sibling repo (`name @ git+https://…@vX.Y.Z`, or a vendored build artefact for the assistant). |

### Deliberately not here

- No submission, no XML, no manifest building, no credential storage.
- No persistence. The element has no idea what IndexedDB is; it exposes
  `getLayout()` / `setLayout()` and the host persists the blob.
- No polling/refresh loop. The host decides when to call `setRows()`.
- No routing, no tabs, no app chrome.

---

## 2. Build artefacts

| Artefact | Consumer | Notes |
|---|---|---|
| `dist/ena-browser.js` (ESM) + `dist/ena-browser.d.ts` | dhtb, the standalone app, anything with a bundler | `handsontable` is a **peer** dependency (not bundled) to avoid two Handsontable copies in one page. |
| `dist/ena-browser.iife.js` | **mimicc-ena-submission-assistant** (`<script src>`, no build step) | Handsontable **is** bundled here. Registers `<ena-browser>` and exposes `window.EnaBrowser`. |
| `dist/ena-browser.css` | both | Element styles only. Handsontable's own CSS ships inside the IIFE and is imported by the ESM entry. |
| `demo/index.html` | humans + Playwright | Static page, fixture rows by default, live Reports API with credentials entered in the page. This is the seed of the standalone "browse my Webin reports" app. |

---

## 3. Public API

```ts
type Mode = "read" | "edit";
type SelectionMode = "none" | "single" | "multi";
type Entity = "studies" | "samples" | "runs" | "experiments" | "analyses" | "files";

interface EnaBrowserConfig {
  entity: Entity;                  // drives the default column set + row-key field
  mode?: Mode;                     // default "read"
  rows?: Record<string, unknown>[];
  source?: DataSource;             // async alternative to rows (see §4)
  columns?: ColumnSpec[];          // override/extend the entity defaults
  customColumns?: CustomColumnSpec[];
  filters?: FilterSpec[];          // initial, programmatic filters
  sort?: SortSpec[];
  statusFilter?: StatusFilterSpec; // the cancelled/suppressed toggles
  selectionMode?: SelectionMode;   // default "none"
  editableColumns?: string[];      // in edit mode, the only writable fields
  rowActions?: RowActionSpec[];    // buttons the element renders, the host executes
  layout?: Layout;                 // pinned/hidden/ordered columns + widths
  height?: number | string;
  license?: string;                // Handsontable licenseKey passthrough
}
```

### Methods

| Method | Purpose |
|---|---|
| `setRows(rows)` / `getRows()` | Replace / read the backing data. |
| `refresh()` | Re-run `source.fetch()` if a source was configured. |
| `setMode(mode)` | Flip read ↔ edit without losing filters or selection. |
| `getChangeSet(): ChangeSet` | `{ rows: [{ key, accession, before, after, changed: string[] }] }` — everything the host needs to build a MODIFY manifest. |
| `clearChanges()` | Call after the host has successfully submitted. |
| `getSelection(): string[]` / `setSelection(keys)` / `clearSelection()` | Row keys (accessions), in click order. |
| `setCustomValues(column, map)` | Update a dynamic column, e.g. `setCustomValues("reads_assigned", {ERS1: 2})`. Cheap: patches cells in place, never re-sorts or loses selection. |
| `setFilters(specs)` / `getFilters()` / `setSort(specs)` | Programmatic filter/sort control; mirrors what the UI writes. |
| `getLayout()` / `setLayout(layout)` | Column order, pins, hidden columns, widths — for the host to persist. |
| `getVisibleRows()` | The rows currently passing the filters, in display order (for "export what I see"). |

### Events

All are `CustomEvent`s on the element, prefixed `ena-browser:`.

| Event | `detail` | Fired when |
|---|---|---|
| `ready` | `{}` | Grid mounted. |
| `selection-change` | `{ keys, rows, lastKey }` | A row is selected/deselected. **This is the pairing hook** — the host records `lastKey` and waits for the next click in the reads element. |
| `change` | `{ changes: ChangeSet }` | An edit was committed (edit mode only). |
| `row-action` | `{ action, key, row }` | A `rowActions` button was clicked. The element does nothing else — the host performs release/hold/suppress/cancel. |
| `filter-change` | `{ filters, sort, visibleCount }` | Filters or sort changed. |
| `layout-change` | `{ layout }` | Columns pinned, moved, hidden or resized. |
| `error` | `{ message }` | A configured `source` fetch failed. |

### Filter spec

Flexible enough for per-column UI filters and host-driven ones, and it maps
one-to-one onto Handsontable's `Filters` conditions:

```ts
type FilterSpec = {
  column: string;
  operator: "eq" | "neq" | "contains" | "not_contains" | "begins" | "ends"
          | "in" | "not_in" | "empty" | "not_empty" | "gt" | "gte" | "lt" | "lte" | "between";
  value?: unknown;
  values?: unknown[];   // for in / not_in
};
```

`statusFilter` is sugar over the same machinery, because "hide cancelled and
suppressed" is the one filter every consumer wants:

```ts
type StatusFilterSpec = {
  include?: string[];              // explicit allow-list of ENA status values
  excludeCancelled?: boolean;      // default true
  excludeSuppressed?: boolean;     // default true
};
```

The element renders these as two checkboxes in its toolbar, so a host that
passes nothing still gets the toggles.

### Custom columns

```ts
type CustomColumnSpec = {
  name: string;              // e.g. "reads_assigned"
  title: string;             // e.g. "Reads"
  type?: "numeric" | "text" | "checkbox";
  pinned?: boolean;          // default true for custom columns — they are the point
  readOnly?: boolean;        // default true; the host owns the values
  default?: unknown;
  render?: "badge" | "text"; // badge = the pill styling the assistant already uses
};
```

Custom column values live in a separate map keyed by row key, **not** in the row
objects, so `getChangeSet()` never proposes them to ENA.

---

## 4. Data sources

```ts
interface DataSource {
  fetch(opts: { entity: Entity; signal: AbortSignal }): Promise<Record<string, unknown>[]>;
}
```

Two shipped implementations:

- `rowsSource(rows)` — trivial, for hosts that already have the data.
- `enaReportsSource({ baseUrl, username, password, test })` — calls the Webin
  Reports API (`/api/v2/reports/<entity>`) directly from the browser with Basic
  auth. Optional; used by `demo/` and the future standalone app. If ENA's CORS
  policy blocks a direct browser call, this adapter is the *only* thing that
  breaks, and hosts with a backend (the assistant) are unaffected. Verify this
  in Phase 6 of the plan before promising a backend-free standalone app.

---

## 5. Theming

The element inherits from CSS custom properties with the same names the
assistant already defines (`--bg`, `--panel`, `--line`, `--fg`, `--muted`,
`--accent`, `--ok`, `--bad`, `--warn`), falling back to its own defaults when
they're absent. It also honours `data-theme="light" | "dark"` on any ancestor,
so the assistant's existing theme switch drives it for free — no `setTheme()`
call, no postMessage bridge, because it is not in an iframe.

---

## 6. Where functionality belongs

| Concern | Owner | Not |
|---|---|---|
| Grid rendering, filter/sort/pin/reorder/hide | **ena-browser** | assistant |
| ENA status vocabulary + the cancelled/suppressed toggles | **ena-browser** | assistant |
| Row selection semantics + selection events | **ena-browser** | assistant |
| Edit tracking / change-set diffing | **ena-browser** | assistant, toolkit |
| Dynamic "reads assigned" column rendering | **ena-browser** | assistant |
| *Computing* how many reads a sample has | **assistant** (it owns the run rows) | ena-browser |
| Pairing: matching a selected sample to a clicked read group | **assistant** | ena-browser |
| Fetching records, Webin credentials, test/prod switching | **assistant** (or `enaReportsSource` for the standalone app) | ena-browser core |
| Persisting layout/filters across sessions | **assistant** (IndexedDB) | ena-browser |
| Turning a change set into a MODIFY manifest/XML | **ena-submission-toolkit** | ena-browser |
| HTTP to ENA submission endpoints | **ena-api-client** | ena-browser |
| Lifecycle actions (release/hold/suppress/cancel) | **assistant** — element only emits `row-action` | ena-browser |

---

## 7. Consumers

- **mimicc-ena-submission-assistant** — vendors `dist/ena-browser.iife.js` +
  `.css` into `server/static/vendor/` at a pinned tag, exactly as it vendors the
  DataHarmonizer bundle. Replaces the hand-rolled table in
  `server/static/records.js` and the `sample-item` list in
  `server/static/reads.js`. See that repo's `ENA_BROWSER_PLAN.md`.
- **Standalone ENA Webin report browser** — `demo/` grown into its own page:
  credentials in, entity picker, grid out. No backend.
- **dataharmonizer-template-builder** — no current use; the ESM build is
  importable if one appears.
