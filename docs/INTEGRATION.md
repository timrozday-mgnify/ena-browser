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
  records.setRows(await reload());   // the element re-reads nothing on its own
});
```

## 2. The pairing panel (samples ↔ reads)

The element provides the *samples* side: selection events and a pinned,
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
import "ena-browser";           // registers <ena-browser>
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

| Event | `detail` |
|---|---|
| `ena-browser:ready` | `{}` |
| `ena-browser:selection-change` | `{ keys, rows, lastKey }` |
| `ena-browser:change` | `{ changes: ChangeSet }` |
| `ena-browser:row-action` | `{ action, key, row }` |
| `ena-browser:filter-change` | `{ filters, sort, visibleCount }` |
| `ena-browser:layout-change` | `{ layout }` |
| `ena-browser:error` | `{ message }` |

All bubble and cross shadow boundaries (`bubbles: true, composed: true`).

## Theming

The element reads `--bg`, `--panel`, `--line`, `--fg`, `--muted`, `--accent`,
`--ok`, `--bad`, `--warn` from any ancestor and honours
`data-theme="light" | "dark"`. The assistant's existing theme switch drives it
with no extra code.
