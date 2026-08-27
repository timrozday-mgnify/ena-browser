# Integrating ena-browser

Three copy-pasteable snippets. All of them use the same element; only the
wiring differs.

No tag has been cut yet, so the vendored/pinned versions below are what the
first release will look like, not something you can `npm i` today.

## 1. The assistant's Records tab (no build step)

Vendor `dist/ena-browser.iife.js` and `dist/ena-browser.css` into
`server/static/vendor/` at a pinned tag, exactly as the DataHarmonizer bundle
arrives. The IIFE bundles Handsontable, so nothing else is needed.

```html
<link rel="stylesheet" href="/static/vendor/ena-browser.css" />
<script src="/static/vendor/ena-browser.iife.js"></script>

<ena-browser id="records" entity="samples" mode="edit" height="600"></ena-browser>

<script>
  const records = document.getElementById("records");

  records.config = {
    entity: "samples",
    mode: "edit",
    editableColumns: ["title", "alias"],
    // statusFilter defaults to hiding cancelled + suppressed; the toolbar
    // renders the two checkboxes either way.
  };

  // The host owns fetching. Call setRows whenever it has fresh data.
  fetch("/api/reports/samples")
    .then((response) => response.json())
    .then((rows) => records.setRows(rows));

  records.addEventListener("ena-browser:change", (event) => {
    // event.detail.changes = { rows: [{ key, accession, before, after, changed }] }
    // Hand this to ena-submission-toolkit to build a MODIFY submission.
    console.log(event.detail.changes);
  });

  // Persist the layout wherever the host keeps state (IndexedDB in the
  // assistant); the element itself remembers nothing across reloads.
  records.addEventListener("ena-browser:layout-change", (event) => {
    saveLayout("samples", event.detail.layout);
  });
  records.setLayout(loadLayout("samples") ?? {});
</script>
```

After a successful submission, call `records.clearChanges()`.

### Lifecycle buttons

`rowActions` draws a frozen button column; the element announces the click and
does nothing else, so release/hold/suppress/cancel stay entirely with the host.

```js
records.applyConfig({
  rowActions: [
    { action: "release", label: "Release", title: "Release this record now" },
    { action: "suppress", label: "Suppress" },
  ],
});

records.addEventListener("ena-browser:row-action", async (event) => {
  const { action, key, row } = event.detail;
  await fetch(`/api/records/${key}/${action}`, { method: "POST" });
  records.setRows(await reload()); // the element re-reads nothing on its own
});
```

## 2. The pairing panel (samples ↔ reads)

The element provides the _samples_ side: selection events and a pinned,
live-updating "reads assigned" column the host writes into. Computing the
counts and matching a sample to a read group stay in the host.

```js
const samples = document.querySelector("ena-browser");

samples.config = {
  entity: "samples",
  selectionMode: "single",
  rows: sampleRows,
  customColumns: [
    { name: "reads_assigned", title: "Reads", type: "numeric", render: "badge", default: 0 },
  ],
};

let pendingSample = null;

samples.addEventListener("ena-browser:selection-change", (event) => {
  // lastKey is the row just clicked — the pairing hook.
  pendingSample = event.detail.lastKey;
});

// When the user then clicks a read group in the host's own UI:
function assignReads(readGroup) {
  if (!pendingSample) return;
  assignments.set(pendingSample, (assignments.get(pendingSample) ?? 0) + readGroup.count);
  // Cheap: patches the cells in place. Sort, filters, scroll position and
  // selection all survive.
  samples.setCustomValues("reads_assigned", assignments);
}
```

`demo/demo.ts` does exactly this with a `+1 read` button — run
`npm run dev` and open `/demo/index.html` to watch the events.

## 3. ESM import (bundler present)

`handsontable` is a peer dependency here, so the page gets exactly one copy.

```ts
import "ena-browser"; // registers <ena-browser>
import "ena-browser/style.css";
import { enaReportsSource, type EnaBrowserElement } from "ena-browser";

const element = document.createElement("ena-browser") as EnaBrowserElement;
element.config = {
  entity: "runs",
  selectionMode: "multi",
  // Optional adapter: talks to the Webin Reports API straight from the
  // browser. Hosts with a backend pass `rows` instead.
  source: enaReportsSource({ username, password, test: true }),
};
document.body.appendChild(element);
await element.refresh();

const forExport = element.getVisibleRows(); // "export what I see"
```

## Events, in one table

| Event                          | `detail`                                  |
| ------------------------------ | ----------------------------------------- |
| `ena-browser:ready`            | `{ source }`                              |
| `ena-browser:selection-change` | `{ keys, rows, lastKey, source }`         |
| `ena-browser:change`           | `{ changes: ChangeSet, source }`          |
| `ena-browser:row-action`       | `{ action, key, row, source }`            |
| `ena-browser:filter-change`    | `{ filters, sort, visibleCount, source }` |
| `ena-browser:layout-change`    | `{ layout, source }`                      |
| `ena-browser:error`            | `{ message }`                             |

All bubble and cross shadow boundaries (`bubbles: true, composed: true`).

`source` is `"user"` for a gesture and `"api"` for anything the host caused
with `setState()` — see below.

## Undo/redo

The element keeps no history of its own. It exposes one snapshot instead, so a
host stack (the assistant's session snapshots, or any command stack) owns the
history:

```js
const state = element.getState();
// { edits, layout, filters, sort, selection } — JSON-safe, structuredClone-safe

element.setState(state); // restore; partial states are fine
```

Wiring it to a stack is three lines. Push on `"user"`, ignore `"api"`, or the
stack records its own replays:

```js
const undo = [element.getState()];
let at = 0;

for (const name of ["change", "filter-change", "layout-change", "selection-change"]) {
  element.addEventListener(`ena-browser:${name}`, (e) => {
    if (e.detail.source !== "user") return; // a replay, not a gesture
    undo.length = at + 1; // drop the redo tail
    undo.push(element.getState());
    at = undo.length - 1;
  });
}

const apply = (i) => {
  at = i;
  element.setState(undo[i]);
};
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  const next = e.shiftKey ? at + 1 : at - 1;
  if (undo[next]) {
    e.preventDefault();
    apply(next);
  }
});
```

Notes:

- `setState()` is idempotent — restoring an earlier `edits` set rewinds every
  cell the target state does not edit back to its original value, so replaying
  out of order can't leave a stale edit behind.
- `edits` are keyed by row key. Rows the host has since replaced with
  `setRows()` are dropped from a restored state rather than resurrected —
  `setRows()` is a new baseline and clears pending edits, so snapshot the state
  before you swap rows if you want to cross that boundary.
- Rows are deliberately _not_ in the snapshot: the host owns them. A stack that
  needs to undo across a `setRows()` stores its own rows next to the state.
- Debounce the push if you want one undo step per edit burst rather than per
  cell; the element does no coalescing.

## Theming

The element reads `--bg`, `--panel`, `--line`, `--fg`, `--muted`, `--accent`,
`--ok`, `--bad`, `--warn` from any ancestor.

Light/dark is the `theme` property (or `theme` attribute): `"auto"` (default),
`"light"`, `"dark"`.

```js
browser.theme = "dark"; // the assistant drives it explicitly
browser.theme = "auto"; // follow the page again
browser.resolvedTheme; // "light" | "dark"
browser.addEventListener("ena-browser:theme-change", (e) =>
  console.log(e.detail.theme, e.detail.resolvedTheme),
);
```

On `auto` it follows the nearest ancestor's `data-theme="light" | "dark"`,
then the OS `prefers-color-scheme`, and re-resolves whenever either changes —
so the assistant's existing theme switch drives it with no extra code. The
resolved value is stamped on the element as `data-theme`, so host CSS can key
off it too.

Host `--bg`/`--fg`/… win while the element's theme matches the page's. Pin the
element to a theme the page isn't using and it ignores them — it marks itself
`data-theme-detached` and falls back to its own palette, so a light grid on a
dark page stays legible.
