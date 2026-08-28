/**
 * `<ena-browser>` — a thin shell over `EnaGrid` + `EnaToolbar`.
 *
 * Light DOM on purpose: Handsontable's overlays and document-level event
 * handling fight Shadow DOM (README §1).
 */

import { EnaGrid } from "./grid.js";
import { EnaToolbar } from "./toolbar.js";
import type {
  BrowserState,
  ChangeSet,
  ColumnSpec,
  EnaBrowserConfig,
  Entity,
  FilterSpec,
  Layout,
  Mode,
  Row,
  SelectionMode,
  SortSpec,
  Theme,
} from "./types.js";

const FORWARDED = [
  "ready",
  "selection-change",
  "change",
  "row-action",
  "filter-change",
  "layout-change",
  "column-change",
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
  static observedAttributes = ["entity", "mode", "selection-mode", "height", "theme"];

  private _config: EnaBrowserConfig = { entity: "samples" };
  private grid: EnaGrid | null = null;
  private toolbar: EnaToolbar | null = null;
  private pending: AbortController | null = null;
  private mounted = false;
  /** Only live while connected — both feed `applyTheme()` in `auto` mode. */
  private darkQuery: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;

  // --------------------------------------------------------------- lifecycle

  connectedCallback(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.readAttributes();
    this.build();
    this.watchTheme();
    if (this._config.source) void this.refresh();
  }

  disconnectedCallback(): void {
    this.mounted = false;
    this.pending?.abort();
    this.pending = null;
    this.unwatchTheme();
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
    if (this._config.height !== undefined) {
      this.style.height =
        typeof this._config.height === "number" ? `${this._config.height}px` : this._config.height;
    }
    // Handsontable reads the computed overflow of its host's ancestors when it
    // decides what scrolls it — on a detached host it finds nothing and falls
    // back to the window, and the column headers then never track a horizontal
    // scroll. So the host is in the document before the grid is built.
    this.applyTheme();
    this.appendChild(gridHost);
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
    this.insertBefore(this.toolbar.element, gridHost);
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
    const state = this.grid?.getState();
    this.teardown();
    this.build();
    if (state) this.grid?.setState(state);
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
    if (partial.theme) this.applyTheme();
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

  /** `"light" | "dark" | "auto"`. `auto` follows the page, then the OS. */
  get theme(): Theme {
    return this._config.theme ?? "auto";
  }

  set theme(theme: Theme) {
    this.applyConfig({ theme });
  }

  /** The concrete theme in force — `auto` already resolved. */
  get resolvedTheme(): "light" | "dark" {
    return this.dataset.theme === "dark" ? "dark" : "light";
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

  /**
   * Add an editable column that is not in the report, e.g. a sample attribute
   * to set. Its values are ordinary edits, so they land in `getChangeSet()`.
   */
  addColumn(spec: ColumnSpec | string): void {
    this.grid?.addColumn(typeof spec === "string" ? { name: spec } : spec);
    this.syncColumns();
  }

  /** Delete a column added with `addColumn()`, with its values and edits. */
  removeColumn(name: string): void {
    this.grid?.removeColumn(name);
    this.syncColumns();
  }

  /** Row keys whose edits are excluded from the change set. */
  getExcluded(): string[] {
    return this.grid?.getExcluded() ?? [];
  }

  setExcluded(keys: string[]): void {
    this.grid?.setExcluded(keys);
  }

  /** Keep our config in step with the grid's, so a rebuild keeps the column. */
  private syncColumns(): void {
    const config = this.grid?.getConfig();
    if (!config) return;
    this._config = {
      ...this._config,
      columns: config.columns,
      editableColumns: config.editableColumns,
    };
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

  /**
   * One snapshot of everything the user can change (edits, layout, filters,
   * sort, selection) — the unit a host's undo/redo stack stores.
   */
  getState(): BrowserState {
    return (
      this.grid?.getState() ?? {
        edits: [],
        layout: {},
        filters: [],
        sort: [],
        selection: [],
      }
    );
  }

  /**
   * Restore a snapshot taken with `getState()`. Every event fired while
   * restoring carries `source: "api"`; push on `"user"` only, or the stack
   * records its own replays.
   */
  setState(state: Partial<BrowserState>): void {
    this.grid?.setState(state);
  }

  getVisibleRows(): Row[] {
    return this.grid?.getVisibleRows() ?? [];
  }

  // ------------------------------------------------------------------- theme

  /**
   * Stamps the resolved theme on the element, so the CSS never has to reason
   * about `auto` — and neither does a host that styles around us.
   */
  private applyTheme(): void {
    const setting = this._config.theme ?? "auto";
    const page = this.detectTheme();
    const resolved = setting === "auto" ? page : setting;
    // Host colours are only right while we match the page — see styles.css.
    this.toggleAttribute("data-theme-detached", resolved !== page);
    if (this.dataset.theme !== resolved) {
      this.dataset.theme = resolved;
      this.dispatchEvent(
        new CustomEvent("ena-browser:theme-change", {
          detail: { theme: setting, resolvedTheme: resolved },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.grid?.setTheme(resolved);
  }

  /** Nearest ancestor `data-theme`, else the OS preference. */
  private detectTheme(): "light" | "dark" {
    this.darkQuery ??= globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    const owner = this.parentElement?.closest<HTMLElement>("[data-theme]");
    const inherited = owner?.dataset.theme;
    if (inherited === "dark" || inherited === "light") return inherited;
    return this.darkQuery?.matches ? "dark" : "light";
  }

  private readonly onThemeSignal = (): void => {
    if ((this._config.theme ?? "auto") === "auto") this.applyTheme();
  };

  private watchTheme(): void {
    this.applyTheme();
    this.darkQuery?.addEventListener("change", this.onThemeSignal);
    // ponytail: one document-wide observer beats walking ancestors on a timer.
    this.themeObserver = new MutationObserver(this.onThemeSignal);
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
      subtree: true,
    });
  }

  private unwatchTheme(): void {
    this.darkQuery?.removeEventListener("change", this.onThemeSignal);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }
}

function coerce(key: string, value: string): string | number {
  if (key !== "height") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export type { Entity, Mode, SelectionMode, Theme };
