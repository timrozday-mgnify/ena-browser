# ena-browser — implementation plan

**Status: phases 0–6 are built.** This file stays as written — it is the
schedule that was followed, not a live checklist — with a `Built` note under
each phase saying what actually landed and where it diverged. The one piece of
the README's API that is *not* implemented is listed under
[Known gaps](#known-gaps) at the end; everything else on this page exists and is
tested.

Step-by-step build order for an agent. Read [README.md](README.md) first; it is
the contract, this is the schedule. Each phase ends with something runnable and
a test that fails if the phase's logic breaks. Do not start a phase before the
previous phase's tests pass.

Conventions: TypeScript strict, no framework, no dependency added that isn't in
`package.json` below. Keep the whole thing small — the target is roughly
1,200–1,800 lines of `src/`, not a framework.

---

## Phase 0 — Repo skeleton

1. `package.json`:

```json
{
  "name": "ena-browser",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/ena-browser.js",
  "types": "./dist/ena-browser.d.ts",
  "exports": { ".": { "types": "./dist/ena-browser.d.ts", "import": "./dist/ena-browser.js" },
               "./style.css": "./dist/ena-browser.css" },
  "files": ["dist"],
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build && vite build --mode iife",
    "test": "vitest run",
    "test:browser": "playwright test",
    "lint": "tsc --noEmit"
  },
  "peerDependencies": { "handsontable": "^17.1.0" },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "handsontable": "^17.1.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0"
  }
}
```

2. `tsconfig.json` — copy dhtb's (`strict`, `moduleResolution: "bundler"`,
   `target: "ES2022"`, `lib: ["ES2022", "DOM"]`), plus `declaration: true`.
3. `vite.config.ts` — library mode, two modes:
   - default: `formats: ["es"]`, `rollupOptions.external: ["handsontable", /^handsontable\//]`.
   - `--mode iife`: `formats: ["iife"]`, `name: "EnaBrowser"`, **nothing external**
     (Handsontable bundled), `emptyOutDir: false`.
   CSS emits to `dist/ena-browser.css` in both.
4. Already in the repo: `.gitignore`, `.editorconfig`, `.pre-commit-config.yaml`,
   `.prettierrc`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`. Add `prettier`
   to `devDependencies` (the pre-commit hook runs its own copy, but editors and
   `npx prettier` want it local), run `pre-commit install`, and follow the
   `ponytail:` note in `.github/workflows/ci.yml` — split the guarded build
   block into named steps and turn on `cache: npm`.
5. `README.md` (already written), this file, `LICENSE` — match the sibling repos.

**Check:** `npm install && npm run build` produces `dist/ena-browser.js`,
`dist/ena-browser.iife.js`, `dist/ena-browser.css`; `pre-commit run --all-files`
and both CI jobs pass on the Phase 0 PR.

**Built.** All three artefacts plus `dist/ena-browser.d.ts` and per-module
`.d.ts` files. Changes to the plan as written:

- Two tsconfigs, not one: `tsconfig.json` (`noEmit`, covers `src`, `tests`,
  `demo` and the config files — this is what `npm run lint` and the pre-commit
  hook check) and `tsconfig.build.json` (`emitDeclarationOnly` over `src`).
  `tsc -b` would have needed a composite project for no gain.
- `npm run build` runs the two Vite builds *first*, then `tsc`, because the ESM
  build empties `dist/`. It finishes by writing a one-line
  `dist/ena-browser.d.ts` re-exporting `./index`, which is what
  `package.json#types` points at.
- `@types/node` added (`playwright.config.ts` reads `process.env`).
- No `LICENSE`: no sibling repo has one, so there was nothing to match.

---

## Phase 1 — Types and pure logic (no DOM)

Files: `src/types.ts`, `src/entities.ts`, `src/filters.ts`, `src/changes.ts`.

1. `src/types.ts` — every interface from README §3 verbatim. This file is the
   API; nothing else exports types.
2. `src/entities.ts` — per-entity defaults:
   - `ROW_KEY[entity]` — the field that identifies a row. For every entity:
     `accession`, falling back to `secondary_accession`, then `alias`. Implement
     as `rowKey(entity, row): string`, not a constant, because Reports rows are
     inconsistent about which accession they carry.
   - `DEFAULT_COLUMNS[entity]` — take the current assistant lists as the
     starting point (studies/samples: `accession, secondary_accession, alias,
     title, status`; runs: `accession, alias, experiment_accession,
     study_accession, sample_accession, status`; experiments: `accession,
     alias, title, study_accession, sample_accession, status`; analyses:
     `accession, alias, title, study_accession, status`; files: derive from the
     first row).
   - `mergeColumns(entity, rows, configColumns, customColumns)` — defaults,
     then any config overrides, then **any extra keys present in the data**
     appended as text columns (Reports rows carry `extra="allow"` fields; losing
     them silently is the bug the assistant's debug logging exists to catch),
     then custom columns.
   - `STATUS` constants: `CANCELLED`, `SUPPRESSED`, `PRIVATE`, `PUBLIC`,
     `DRAFT`, and `normalizeStatus(row)` → upper-cased `row.status ?? ""`.
3. `src/filters.ts`:
   - `toHandsontableCondition(spec: FilterSpec)` → `{ name, args }` for the
     Filters plugin (`eq`→`eq`, `contains`→`contains`, `in`→`by`, `gt`→`gt`,
     `between`→`between`, `empty`→`empty`, …).
   - `fromHandsontableConditions(stack)` → `FilterSpec[]`, so `filter-change`
     reports what the user did in the dropdown in the same vocabulary the host
     passes in. Round-tripping matters; test it both ways.
   - `statusFilterToSpec(statusFilter, entity)` → a `not_in` spec on `status`.
   - `applyFilters(rows, specs)` — a plain JS evaluator. Handsontable does the
     real filtering in the grid, but this exists so `getVisibleRows()` and the
     unit tests don't need a DOM.
4. `src/changes.ts`:
   - `diffRow(before, after, editableColumns)` → `{ changed: string[] }`.
   - `ChangeTracker` class: `record(key, column, oldValue, newValue)`,
     `get(): ChangeSet`, `clear()`. Reverting a cell to its original value
     **removes** it from the change set (do not emit no-op modifications to
     ENA). Custom-column values are never tracked.

**Tests (`tests/unit/`, Vitest):**
- `filters.test.ts` — every operator evaluates correctly; every spec round-trips
  through `toHandsontableCondition`/`fromHandsontableConditions`; `in`/`not_in`
  with an empty list; `between` with reversed bounds.
- `changes.test.ts` — edit → change set; edit-then-revert → empty change set;
  edits to a non-editable column are rejected; custom columns excluded.
- `entities.test.ts` — `rowKey` fallback chain; `mergeColumns` keeps unknown
  data keys and puts custom columns last; duplicate names collapse.

**Built.** 63 cases across the three files, all as specified. One thing the plan
could not know: Handsontable's value-list condition is named **`by_value`**, not
`by`, so that is what `toHandsontableCondition` emits. And Handsontable has no
`not_in` at all — `toHandsontableCondition(spec, columnValues)` turns it into a
`by_value` over the complement, which means `not_in` round-trips back as an
equivalent `in` rather than as itself. Every other operator round-trips
verbatim, and both behaviours are asserted in `filters.test.ts`.

---

## Phase 2 — The grid core

Files: `src/grid.ts`, `src/styles.css`.

`EnaGrid` is a plain class wrapping one Handsontable instance. **No custom
element yet** — the element in Phase 4 is a thin shell over this, which keeps
the grid testable in isolation.

1. Construct Handsontable with:
   `columns` from `mergeColumns`, `data` = row objects, `rowHeaders: false`,
   `colHeaders` from column titles, `filters: true`, `dropdownMenu` (the filter
   UI), `multiColumnSorting: true`, `manualColumnMove: true`,
   `manualColumnResize: true`, `hiddenColumns: { columns: [], indicators: true }`,
   `fixedColumnsStart` from the layout, `contextMenu` with the pin/unpin and
   hide/show items (§ below), `licenseKey` from config,
   `stretchH: "last"`, `autoWrapRow: false`, and the 30px fixed row height the
   assistant already forces on DataHarmonizer (`.ena-browser .handsontable td`
   in `styles.css`, not JS).
2. `readOnly` is derived: `true` in read mode; in edit mode, per-column
   `readOnly: !editableColumns.includes(name)`. Custom columns are always
   read-only unless their spec says otherwise.
3. `afterChange` (source `"edit"`) → `ChangeTracker.record` → `change` event.
   Cells with pending changes get a `.ena-browser-dirty` class via `cells()`.
4. `afterFilter` / `afterColumnSort` → `filter-change` with the specs plus
   `visibleCount`.
5. `afterColumnMove` / `afterColumnResize` / hide / pin → `layout-change`.
6. **Pinning**: Handsontable pins by position, not identity. Implement
   `pin(column)` as: move the column to index `fixedColumnsStart`, then
   increment `fixedColumnsStart`. `unpin(column)` reverses it. Store pins in the
   layout as *column names*, and re-derive positions in `setLayout()` — never
   persist raw indices, they break the moment a column set changes.
7. **Custom columns**: values live in `Map<rowKey, unknown>` per column. A
   Handsontable custom renderer reads from the map. `setCustomValues(column, map)`
   merges and calls `render()` on only the affected rows — no `loadData`, so
   sort, filters, scroll position and selection all survive. This is the
   requirement for the live "reads assigned" count; write the test for it first.
8. **Selection**: a leading, always-pinned checkbox column when
   `selectionMode !== "none"`; clicking a row's cells also toggles it in
   `single` mode. Keep the selected key list in insertion order — the pairing
   flow needs "the one just clicked" (`lastKey`).
9. `getVisibleRows()` uses `applyFilters` + the sort comparator, *not*
   Handsontable's internal row map, so it works identically headless.

**Tests:** Vitest + jsdom for construction and `setCustomValues` map handling;
the real interaction tests are Phase 5 (Playwright) — jsdom does not render
Handsontable faithfully enough to trust for layout.

**Built.** `EnaGrid extends EventTarget` and dispatches the event names the
element re-emits, so nothing needed a callback bag. Notes on the numbered items:

- (1) `dropdownMenu` is the filter items only
  (`filter_by_condition`, `filter_operators`, `filter_by_condition2`,
  `filter_by_value`, `filter_action_bar`) — the default menu's insert/remove
  column entries make no sense in a report view.
- (6) Pinning is declarative rather than a move-then-increment: `pin()` appends
  the name to `pinned`, and the display order is rebuilt as
  *selection column → pins in pin order → everything else*, with
  `fixedColumnsStart` derived from it. Same guarantee the plan asked for —
  names are stored, positions are re-derived — with no index juggling.
- (7) `setCustomValues` merges into the map and calls `render()`. Handsontable
  exposes no public per-row repaint; `render()` keeps sort, filters, scroll
  position and selection, which was the actual requirement. Asserted in both
  `grid.test.ts` and `custom-column.spec.ts`.
- jsdom needs `ResizeObserver` and `IntersectionObserver` stubs
  (`tests/setup.ts`) before Handsontable will construct at all.

---

## Phase 3 — Toolbar

File: `src/toolbar.ts`.

A small DOM strip above the grid, all optional and driven by config:

- Status toggles: "Hide cancelled" / "Hide suppressed" checkboxes, wired to
  `statusFilterToSpec`. Default both checked.
- A free-text quick filter across all visible text columns (`contains` on any
  column). One input, debounced 150ms.
- Row count: `"<visible> of <total>"`.
- Selection count + "Clear selection", only when `selectionMode !== "none"`.
- Mode indicator: a "Read-only"/"Editing" pill; in edit mode also
  "<n> pending change(s)" and a "Discard changes" button that reverts the grid
  to the pre-edit values and clears the tracker.
- A "Columns" button opening a checkbox list for show/hide + pin, which is the
  same code path as the context menu items.

No search-engine, no saved views, no export button — the host owns those
(`getVisibleRows()` gives it the data).

**Built** as listed, in `src/toolbar.ts`. Every control carries a
`data-role` attribute (`excludeCancelled`, `excludeSuppressed`, `quick-filter`,
`columns`, `columns-menu`, `clear-selection`, `pending`, `discard`) — that is
what the Playwright specs drive, and it is a stable hook for hosts too.

---

## Phase 4 — The custom element

Files: `src/element.ts`, `src/index.ts`, `src/sources/rows.ts`,
`src/sources/enaReports.ts`.

1. `EnaBrowserElement extends HTMLElement`:
   - Attributes (for HTML-only use): `entity`, `mode`, `selection-mode`,
     `height`. Property `config` for everything else. Attributes and properties
     both funnel into one `applyConfig(partial)`.
   - `connectedCallback` builds toolbar + grid; `disconnectedCallback` destroys
     the Handsontable instance (leaking one per tab switch is the classic bug —
     assert on it in a test).
   - Re-emits every grid/toolbar event as `ena-browser:*` CustomEvents,
     `bubbles: true, composed: true`.
   - Delegates every method in README §3 to the grid.
2. `src/sources/rows.ts` — `rowsSource(rows)`.
3. `src/sources/enaReports.ts` — `enaReportsSource({ baseUrl, username, password, test })`.
   Basic auth header, `AbortSignal` honoured, maps ENA's response array to plain
   rows, throws a message the element surfaces via the `error` event. Default
   `baseUrl`: the Webin Reports base used by `ena-api-client` (read the current
   value out of `ena-api-client/ena_api/config.py` rather than guessing; test vs
   production differ).
4. `src/index.ts` — `customElements.define("ena-browser", …)` (guarded against
   double registration), plus named exports of the classes, sources, and types.

**Built.** Notes:

- `applyConfig(partial)` is public, and is the single funnel for attributes,
  the `config` property and `setMode()`. Structural keys (`columns`,
  `customColumns`, `selectionMode`, `rowActions`, `license`, `height`) rebuild
  the grid, preserving layout and selection across the rebuild; everything else
  is a live update.
- `refresh()` aborts any in-flight fetch before starting the next one.
- The Reports API base is `https://<host>/ena/submit/report` with
  `www.ebi.ac.uk` / `wwwdev.ebi.ac.uk`, read out of
  `ena-api-client/ena_api/config.py` as instructed. The entity path segment for
  `studies` is ENA's `projects`; the rest match. Rows arrive wrapped as
  `[{ report: {...} }]` and are unwrapped.

**Check:** `demo/index.html` with fixture rows renders, filters and sorts. ✅

---

## Phase 5 — Demo page and Playwright tests

1. `demo/index.html` + `demo/demo.ts`:
   - Entity dropdown, "load fixtures" / "load from ENA" (credentials in a form,
     held in memory only — never `localStorage`), mode toggle, selection-mode
     toggle.
   - A panel showing live `selection-change` / `change` / `filter-change`
     payloads. This doubles as the pairing-integration documentation.
   - A "+1 read" button per selected sample that calls
     `setCustomValues("reads_assigned", …)` — proves the pairing mechanism
     end-to-end without any host app.
2. `tests/fixtures/*.json` — realistic Reports API responses for each entity,
   including cancelled and suppressed rows, rows missing `accession` (only
   `secondary_accession`), and rows carrying extra unknown fields. Capture these
   from `ena-api-client`'s test fixtures if it has any; otherwise hand-write
   them from the model definitions in `ena_api/models.py`.
3. `playwright.config.ts` — copy dhtb's; `webServer` runs `vite preview`.
4. `tests/browser/`:
   - `render.spec.ts` — all entities render with the expected headers.
   - `filter.spec.ts` — per-column dropdown filter narrows rows; the status
     toggles hide cancelled/suppressed and restore them; programmatic
     `setFilters` matches the UI result.
   - `sort.spec.ts` — click a header, order changes; multi-column sort.
   - `layout.spec.ts` — pin a column (it stays put while scrolling right),
     reorder by drag, hide/show; `getLayout()` → `setLayout()` on a fresh
     element reproduces it.
   - `selection.spec.ts` — single vs multi; `selection-change` fires with the
     right `lastKey`; selection survives a filter change and a `setCustomValues`
     call. **This is the pairing contract — it must not be flaky.**
   - `edit.spec.ts` — read mode rejects typing; edit mode records a change;
     revert clears it; non-editable columns stay locked; `change` payload shape.
   - `custom-column.spec.ts` — the pinned custom column updates in place while
     scrolled and filtered, with no selection loss.
   - `lifecycle.spec.ts` — removing the element from the DOM destroys the
     Handsontable instance.

**Built** — 31 specs across the eight files, all passing. Notes:

- `playwright.config.ts` runs the **dev server**, not `vite preview`:
  `demo/demo.ts` imports `src/` directly, and preview only serves the library
  build. Port 5174, `ENA_BROWSER_PORT` to override.
- Fixtures were hand-written from `ena_api/models.py` (`ena-api-client` has no
  capturable fixtures), and include cancelled, suppressed, accession-less
  (`secondary_accession` only) and extra-field rows.
- Two Handsontable behaviours the specs had to be written around, both worth
  knowing before touching these files:
  - the master overlay omits the frozen columns, so `edit.spec.ts` finds cells
    by their current *value*, never by index;
  - `manualColumnMove` ignores a mousedown that lands on the header's
    `sortAction` span, and only starts once the column is already selected — so
    the drag test clicks the header first, then presses in its bottom-right
    corner.

---

## Phase 6 — Standalone viability check + release

1. Verify `enaReportsSource` against the real Webin Reports API from a browser.
   If CORS blocks it, say so plainly in the README (§4 already flags this), keep
   the adapter for same-origin/proxied deployments, and note that the standalone
   app needs a tiny proxy. **Do not silently ship a broken promise.**

   **Result (2026-08-27): CORS does not block it.** Both `www.ebi.ac.uk` and
   `wwwdev.ebi.ac.uk` answer the `GET` + `Authorization` preflight with
   `access-control-allow-origin: <requesting origin>` and
   `access-control-allow-credentials: true`. A backend-free standalone app is
   therefore viable. **Only the preflight was checked** — an authenticated
   `GET` needs a real Webin account, so the end-to-end path stays unproven
   until someone runs `demo/index.html` against their own credentials. README §4
   records it in exactly those terms.
2. `docs/INTEGRATION.md` — a copy-pasteable snippet per consumer: the
   assistant's Records tab, the assistant's pairing panel, and an ESM import.
   **Written**, plus an event table and the theming contract.
3. Tag `v0.1.0`. Publish `dist/` as a release asset so the assistant can vendor
   it without a Node toolchain (mirrors how the DataHarmonizer bundle arrives).
   **Not done** — the release is a human decision, and nothing consumes the tag
   yet.

---

## Known gaps

Everything in README §3 exists except one item:

- **`rowActions` renders nothing.** The config key is accepted, the
  `RowActionSpec` type exists, and `row-action` fires — but only from
  `EnaGrid.emitRowAction(action, key)`, which no UI calls. There is no button
  column. A host wanting release/hold/suppress/cancel buttons today has to draw
  them itself and call into the grid. Implementing it is a small, self-contained
  job: one pinned column with a renderer per `RowActionSpec`.

Two smaller notes, deliberate rather than missing:

- The element exposes `setSort()` but not `getSort()`; `EnaGrid` has both, and
  `filter-change` carries the current sort on every change.
- `dist/ena-browser.css` carries Handsontable's CSS and the `ht-theme-main`
  theme as well as the element's own styles, so the IIFE consumer needs one
  `<link>` and no more. README §2 says so.

---

## Testing summary

| Layer | Tool | Runs where |
|---|---|---|
| Filter operators, spec round-trip, change diffing, column merge, row keys | Vitest | `npm test`, CI on every push |
| Element construction/teardown, custom-value map | Vitest + jsdom | same |
| Rendering, filtering, sorting, pinning, reordering, selection, editing | Playwright vs `demo/` | `npm run test:browser`, CI with `--with-deps` |
| Live Reports API adapter | manual, Phase 6 | not in CI (needs credentials) — CORS preflight verified, authenticated GET not |

CI: one GitHub Actions workflow — `npm ci`, `npm run lint`, `npm test`,
`npm run build`, `npx playwright install --with-deps chromium`,
`npm run test:browser`, with the Playwright report uploaded on failure. The
`pre-commit` job runs alongside it with the `tsc` hook skipped (it needs real
`node_modules`, which the `build` job has).

Current counts: **88 Vitest cases**, **31 Playwright specs**.

---

## Fitting into the ecosystem

- **Pinned by tag**, like every other sibling repo. The assistant vendors the
  IIFE build; bumping means committing new files under `server/static/vendor/`
  and updating the version note in its README's "Pinned dependency versions".
- **Depends on nothing in the ecosystem.** It does not import `ena-api-client`,
  `linkml-lib`, `ena-submission-toolkit`, or DataHarmonizer. The only shared
  vocabulary is the Reports API field names (mirrored from
  `ena-api-client/ena_api/models.py`) and the ENA status values — both are data,
  not code, and both are pinned in `src/entities.ts` with a comment pointing at
  the source of truth.
- **Add a row to `ECOSYSTEM.md` §2 and a `4.x` section** in
  `mimicc-ena-submission-assistant` when the first tag lands (already drafted
  there).
