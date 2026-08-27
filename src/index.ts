/** Entry point: registers `<ena-browser>` and re-exports the public API. */

import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "./styles.css";

import { EnaBrowserElement } from "./element.js";

export { EnaBrowserElement } from "./element.js";
export { EnaGrid } from "./grid.js";
export { EnaToolbar } from "./toolbar.js";
export { rowsSource } from "./sources/rows.js";
export {
  enaReportsSource,
  reportsBaseUrl,
  type EnaReportsSourceOptions,
} from "./sources/enaReports.js";
export { ChangeTracker, diffRow } from "./changes.js";
export { DEFAULT_COLUMNS, STATUS, mergeColumns, normalizeStatus, rowKey } from "./entities.js";
export {
  applyFilters,
  fromHandsontableConditions,
  matchesFilter,
  statusFilterToSpec,
  toHandsontableCondition,
} from "./filters.js";
export type * from "./types.js";

export const TAG_NAME = "ena-browser";

/** Idempotent — a page may load both the ESM and the IIFE build. */
export function defineEnaBrowser(tagName: string = TAG_NAME): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, EnaBrowserElement);
}

defineEnaBrowser();
