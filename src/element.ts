/**
 * `<ena-browser>` — a thin shell over `EnaGrid` + `EnaToolbar`.
 *
 * Light DOM on purpose: Handsontable's overlays and document-level event
 * handling fight Shadow DOM (README §1).
 */

import { EnaGrid } from "./grid.js";
import { EnaToolbar } from "./toolbar.js";
import type {
  ChangeSet,
  EnaBrowserConfig,
  Entity,
  FilterSpec,
  Layout,
  Mode,
  Row,
  SelectionMode,
  SortSpec,
} from "./types.js";

const FORWARDED = [
  "ready",
  "selection-change",
  "change",
  "row-action",
  "filter-change",
  "layout-change",
] as const;

/** Structural changes need a fresh Handsontable; the rest are live updates. */
const STRUCTURAL: (keyof EnaBrowserConfig)[] = [
  "columns",
  "customColumns",
  "selectionMode",
  "rowActions",
  "license",
  "height",
];

export class EnaBrowserElement extends HTMLElement {
  static observedAttributes = ["entity", "mode", "selection-mode", "height"];

  private _config: EnaBrowserConfig = { entity: "samples" };
  private grid: EnaGrid | null = null;
  private toolbar: EnaToolbar | null = null;
  private pending: AbortController | null = null;
  private mounted = false;

  // --------------------------------------------------------------- lifecycle

  connectedCallback(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.readAttributes();
    this.build();
    if (this._config.source) void this.refresh();
  }

  disconnectedCallback(): void {
    this.mounted = false;
    this.pending?.abort();
    this.pending = null;
    this.teardown();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (value === null) return;
    const key = name === "selection-mode" ? "selectionMode" : name;
    this.applyConfig({ [key]: coerce(key, value) } as Partial<EnaBrowserConfig>);
  }

  private readAttributes(): void {
    const partial: Record<string, unknown> = {};
    for (const name of EnaBrowserElement.observedAttributes) {
      const value = this.getAttribute(name);
      if (value === null) continue;
      const key = name === "selection-mode" ? "selectionMode" : name;
      partial[key] = coerce(key, value);
    }
    this._config = { ...this._config, ...partial };
  }

  private build(): void {
    this.classList.add("ena-browser");
    const gridHost = document.createElement("div");
    this.grid = new EnaGrid(gridHost, this._config);
    for (const name of FORWARDED) {
      this.grid.addEventListener(name, (event) => {
        this.dispatchEvent(
          new CustomEvent(`ena-browser:${name}`, {
            detail: (event as CustomEvent).detail,
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
    this.toolbar = new EnaToolbar(this.grid, this._config);
    this.appendChild(this.toolbar.element);
    this.appendChild(gridHost);
    if (this._config.height !== undefined) {
      this.style.height =
        typeof this._config.height === "number" ? `${this._config.height}px` : this._config.height;
    }
  }

  private teardown(): void {
    this.toolbar?.destroy();
    this.toolbar = null;
    this.grid?.destroy();
    this.grid = null;
    this.replaceChildren();
  }

  private rebuild(): void {
    if (!this.mounted) return;
    const layout = this.grid?.getLayout();
    const selection = this.grid?.getSelection() ?? [];
    this.teardown();
    this.build();
    if (layout) this.grid?.setLayout(layout);
    if (selection.length) this.grid?.setSelection(selection);
  }

  // ------------------------------------------------------------------ config

  get config(): EnaBrowserConfig {
    return { ...this._config };
  }

  set config(config: EnaBrowserConfig) {
    this.applyConfig(config);
  }

  /** The single funnel every attribute and property write goes through. */
  applyConfig(partial: Partial<EnaBrowserConfig>): void {
    const previous = this._config;
    this._config = { ...previous, ...partial };
    if (!this.grid) return;

    if (STRUCTURAL.some((key) => key in partial)) {
      this.rebuild();
      if (partial.rows) this.grid?.setRows(partial.rows);
      return;
    }
    if (partial.entity && partial.entity !== previous.entity) {
      this.grid.setEntity(partial.entity);
      if (this._config.source) void this.refresh();
    }
    if (partial.mode && partial.mode !== previous.mode) {
      this.grid.setMode(partial.mode);
    }
    if (partial.rows) this.grid.setRows(partial.rows);
    if (partial.filters) this.grid.setFilters(partial.filters);
    if (partial.sort) this.grid.setSort(partial.sort);
    if (partial.statusFilter) this.grid.setStatusFilter(partial.statusFilter);
    if (partial.layout) this.grid.setLayout(partial.layout);
    this.toolbar?.setConfig(this._config);
  }

  // ----------------------------------------------------------------- methods

  setRows(rows: Row[]): void {
    this._config = { ...this._config, rows };
    this.grid?.setRows(rows);
  }

  getRows(): Row[] {
    return this.grid?.getRows() ?? [];
  }

  async refresh(): Promise<void> {
    const source = this._config.source;
    if (!source || !this.grid) return;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    try {
      const rows = await source.fetch({
        entity: this._config.entity,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this.setRows(rows);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.dispatchEvent(
        new CustomEvent("ena-browser:error", {
          detail: { message: error instanceof Error ? error.message : String(error) },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }

  setMode(mode: Mode): void {
    this.applyConfig({ mode });
  }

  getChangeSet(): ChangeSet {
    return this.grid?.getChangeSet() ?? { rows: [] };
  }

  clearChanges(): void {
    this.grid?.clearChanges();
  }

  getSelection(): string[] {
    return this.grid?.getSelection() ?? [];
  }

  setSelection(keys: string[]): void {
    this.grid?.setSelection(keys);
  }

  clearSelection(): void {
    this.grid?.clearSelection();
  }

  setCustomValues(column: string, values: Record<string, unknown> | Map<string, unknown>): void {
    this.grid?.setCustomValues(column, values);
  }

  setFilters(specs: FilterSpec[]): void {
    this.grid?.setFilters(specs);
  }

  getFilters(): FilterSpec[] {
    return this.grid?.getFilters() ?? [];
  }

  setSort(specs: SortSpec[]): void {
    this.grid?.setSort(specs);
  }

  getLayout(): Layout {
    return this.grid?.getLayout() ?? {};
  }

  setLayout(layout: Layout): void {
    this.grid?.setLayout(layout);
  }

  getVisibleRows(): Row[] {
    return this.grid?.getVisibleRows() ?? [];
  }
}

function coerce(key: string, value: string): string | number {
  if (key !== "height") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export type { Entity, Mode, SelectionMode };
