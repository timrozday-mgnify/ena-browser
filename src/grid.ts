/**
 * `EnaGrid` — one Handsontable instance plus the ENA-specific behaviour:
 * pinning by column name, a selection column, host-owned custom columns and
 * edit tracking.
 *
 * Deliberately not a custom element: the element in `element.ts` is a thin
 * shell over this, which keeps the grid testable on its own.
 */

import Handsontable from "handsontable/base";
import { registerAllModules } from "handsontable/registry";
import type { ColumnConditions } from "handsontable/plugins/filters";

import { ChangeTracker } from "./changes.js";
import { mergeColumns, rowKey } from "./entities.js";
import {
  applyFilters,
  fromHandsontableConditions,
  matchesFilter,
  statusFilterToSpec,
  toHandsontableCondition,
} from "./filters.js";
import type {
  BrowserState,
  ChangeSet,
  ColumnSpec,
  CustomColumnSpec,
  EnaBrowserConfig,
  Entity,
  FilterSpec,
  Layout,
  Row,
  RowActionSpec,
  RowChange,
  SortSpec,
} from "./types.js";

registerAllModules();

const SELECTION_COLUMN = "__selected__";
const ACTIONS_COLUMN = "__actions__";
const INCLUDE_COLUMN = "__include__";
const DEFAULT_LICENSE = "non-commercial-and-evaluation";

function themeName(theme: "light" | "dark"): string {
  return theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main";
}

/** Emits the same event names the element re-dispatches as `ena-browser:*`. */
export class EnaGrid extends EventTarget {
  private hot: Handsontable | null = null;
  private config: EnaBrowserConfig;
  private rows: Row[] = [];
  private original = new Map<string, Row>();
  private tracker = new ChangeTracker();
  private customValues = new Map<string, Map<string, unknown>>();
  private selected: string[] = [];
  private lastKey: string | null = null;
  /** Rows the user unticked in the include column — edit mode only. */
  private excluded = new Set<string>();

  private columns: ColumnSpec[] = [];
  private order: string[] = [];
  private pinned: string[] = [];
  private hidden: string[] = [];
  // Columns deleted from the grid. Report fields land here with a pending
  // "clear this field" edit; discarding the changes brings them back.
  private deleted: string[] = [];
  private widths: Record<string, number> = {};
  /** Column names in the order Handsontable currently holds them. */
  private active: string[] = [];
  private rebuilding = false;
  /** Already resolved to a concrete theme by the element; "auto" never reaches here. */
  private resolvedTheme: "light" | "dark" = "light";
  /** True while `setState()` runs, so events say `source: "api"`. */
  private applying = false;

  private userFilters: FilterSpec[] = [];
  private statusSpec: FilterSpec | null = null;
  private quickFilter = "";
  private sort: SortSpec[] = [];

  constructor(
    private readonly container: HTMLElement,
    config: EnaBrowserConfig,
  ) {
    super();
    this.config = { ...config };
    if (config.theme === "dark" || config.theme === "light") this.resolvedTheme = config.theme;
    this.rows = config.rows ? [...config.rows] : [];
    this.snapshot();
    this.userFilters = config.filters ? [...config.filters] : [];
    this.statusSpec = statusFilterToSpec(config.statusFilter, config.entity);
    this.sort = config.sort ? [...config.sort] : [];
    this.applyLayout(config.layout ?? {});
    for (const spec of config.customColumns ?? []) {
      this.customValues.set(spec.name, new Map());
    }
    this.rebuildColumns();
    this.mount();
  }

  // ---------------------------------------------------------------- lifecycle

  private mount(): void {
    this.container.classList.add("ena-browser-grid");
    this.hot = new Handsontable(this.container, this.settings());
    this.container.addEventListener("click", this.onContainerClick);
    this.applyFiltersToGrid();
    this.applySortToGrid();
    this.emit("ready", {});
  }

  /** `light` | `dark` — the element resolves `auto` before calling. */
  setTheme(theme: "light" | "dark"): void {
    this.resolvedTheme = theme;
    this.applyTheme();
  }

  /** `useTheme()` swaps the class and re-reads Handsontable's own CSS variables. */
  private applyTheme(): void {
    this.hot?.useTheme(themeName(this.resolvedTheme));
  }

  destroy(): void {
    this.container.removeEventListener("click", this.onContainerClick);
    this.hot?.destroy();
    this.hot = null;
  }

  /** Present so tests can assert the instance is really gone. */
  get isDestroyed(): boolean {
    return this.hot === null || this.hot.isDestroyed;
  }

  /**
   * The row object behind a *visual* row index. `getSourceDataAtRow` takes a
   * physical index, and filtering or sorting makes the two differ — reading it
   * with a visual index silently returns the wrong row.
   */
  private sourceRow(visualRow: number): Row | undefined {
    const physical = this.hot?.toPhysicalRow(visualRow);
    if (physical === null || physical === undefined) return undefined;
    return this.hot?.getSourceDataAtRow(physical) as Row | undefined;
  }

  private emit<T extends object>(name: string, detail: T): void {
    const source = this.applying ? "api" : "user";
    this.dispatchEvent(new CustomEvent(name, { detail: { ...detail, source } }));
  }

  // ------------------------------------------------------------------ columns

  private get customSpecs(): CustomColumnSpec[] {
    return this.config.customColumns ?? [];
  }

  private isCustom(name: string): boolean {
    return this.customValues.has(name);
  }

  private rebuildColumns(): void {
    this.columns = mergeColumns(
      this.config.entity,
      this.rows,
      this.config.columns ?? [],
      this.customSpecs,
    ).filter((spec) => !this.deleted.includes(spec.name));
    const names = this.columns.map((c) => c.name);
    // Keep any remembered order, drop names that no longer exist, append new.
    this.order = [
      ...this.order.filter((n) => names.includes(n)),
      ...names.filter((n) => !this.order.includes(n)),
    ];
    for (const spec of this.customSpecs) {
      if (spec.pinned !== false && !this.pinned.includes(spec.name)) {
        this.pinned.push(spec.name);
      }
    }
    this.pinned = this.pinned.filter((n) => names.includes(n));
    this.hidden = this.hidden.filter((n) => names.includes(n));
    for (const spec of this.columns) {
      if (spec.hidden && !this.hidden.includes(spec.name)) {
        this.hidden.push(spec.name);
      }
      if (spec.width !== undefined && this.widths[spec.name] === undefined) {
        this.widths[spec.name] = spec.width;
      }
    }
  }

  /**
   * Display order: selection column, row actions, then pins in pin order, then
   * the rest. The first two are always frozen — they are controls, not data.
   */
  private displayOrder(): string[] {
    const names: string[] = [];
    if (this.config.selectionMode && this.config.selectionMode !== "none") {
      names.push(SELECTION_COLUMN);
    }
    if (this.config.mode === "edit") names.push(INCLUDE_COLUMN);
    if (this.rowActions.length > 0) names.push(ACTIONS_COLUMN);
    names.push(...this.pinned);
    names.push(...this.order.filter((n) => !this.pinned.includes(n)));
    return names;
  }

  private specFor(name: string): ColumnSpec | undefined {
    return this.columns.find((c) => c.name === name);
  }

  private isEditable(name: string): boolean {
    if (this.config.mode !== "edit") return false;
    if (this.isCustom(name)) {
      return this.customSpecs.find((s) => s.name === name)?.readOnly === false;
    }
    const spec = this.specFor(name);
    if (spec?.readOnly) return false;
    const editable = this.config.editableColumns ?? [];
    return editable.includes(name);
  }

  private hotColumns(): Handsontable.ColumnSettings[] {
    return this.displayOrder().map((name) => {
      if (name === SELECTION_COLUMN) return this.selectionColumn();
      if (name === INCLUDE_COLUMN) return this.includeColumn();
      if (name === ACTIONS_COLUMN) return this.actionsColumn();
      if (this.isCustom(name)) return this.customColumn(name);
      const spec = this.specFor(name);
      return {
        data: name,
        title: spec?.title ?? name,
        type: spec?.type === "numeric" ? "numeric" : "text",
        width: this.widths[name],
        readOnly: !this.isEditable(name),
      };
    });
  }

  private get rowActions(): RowActionSpec[] {
    return this.config.rowActions ?? [];
  }

  /**
   * One button per `RowActionSpec`. The element only announces the click —
   * release/hold/suppress/cancel are the host's job (README §6). Clicks are
   * caught by a single delegated listener, because Handsontable throws these
   * cells away and rebuilds them on every render.
   */
  private actionsColumn(): Handsontable.ColumnSettings {
    return {
      data: (() => "") as Handsontable.ColumnSettings["data"],
      title: " ",
      readOnly: true,
      width: this.widths[ACTIONS_COLUMN] ?? 24 + this.rowActions.length * 62,
      className: "ena-browser-actions",
      renderer: (_instance, td, visualRow) => {
        td.textContent = "";
        const row = this.sourceRow(visualRow);
        if (!row) return;
        const key = rowKey(this.config.entity, row);
        for (const action of this.rowActions) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = action.label;
          if (action.title) button.title = action.title;
          button.dataset["enaAction"] = action.action;
          button.dataset["enaKey"] = key;
          td.appendChild(button);
        }
      },
    };
  }

  private onContainerClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement | null)?.closest?.(
      "button[data-ena-action]",
    ) as HTMLButtonElement | null;
    if (!button) return;
    event.stopPropagation();
    const action = button.dataset["enaAction"];
    const key = button.dataset["enaKey"];
    if (action !== undefined && key !== undefined) {
      this.emitRowAction(action, key);
    }
  };

  private selectionColumn(): Handsontable.ColumnSettings {
    const values = (row: Row, value?: unknown): unknown => {
      const key = rowKey(this.config.entity, row);
      if (value === undefined) return this.selected.includes(key);
      this.setRowSelected(key, value === true || value === "true");
      return undefined;
    };
    return {
      data: values as Handsontable.ColumnSettings["data"],
      title: " ",
      type: "checkbox",
      width: 32,
      readOnly: false,
      className: "htCenter",
    };
  }

  /**
   * "Include this row in the MODIFY". Ticked by default: the host builds the
   * manifest from `getChangeSet()`, which drops the unticked rows.
   */
  private includeColumn(): Handsontable.ColumnSettings {
    const values = (row: Row, value?: unknown): unknown => {
      const key = rowKey(this.config.entity, row);
      if (value === undefined) return !this.excluded.has(key);
      this.setRowIncluded(key, value === true || value === "true");
      return undefined;
    };
    return {
      data: values as Handsontable.ColumnSettings["data"],
      title: "\u2713",
      type: "checkbox",
      width: 32,
      readOnly: false,
      className: "htCenter",
    };
  }

  private setRowIncluded(key: string, included: boolean): void {
    if (key === "") return;
    if (included) this.excluded.delete(key);
    else this.excluded.add(key);
    this.hot?.render();
    this.emit("change", { changes: this.getChangeSet() });
  }

  /** Row keys whose edits are excluded from the change set. */
  getExcluded(): string[] {
    return [...this.excluded];
  }

  setExcluded(keys: string[]): void {
    this.excluded = new Set(keys);
    this.hot?.render();
    this.emit("change", { changes: this.getChangeSet() });
  }

  // ------------------------------------------------------------ add / remove

  /**
   * Add an editable column that is not in the report — a sample attribute the
   * user wants to set. Values land in the row like any other edit, so they
   * reach the change set (and the host's MODIFY manifest) for free.
   */
  addColumn(spec: ColumnSpec): void {
    const name = spec.name.trim();
    if (name === "" || this.specFor(name) || isControlColumn(name)) return;
    this.config.columns = [...(this.config.columns ?? []), { ...spec, name, custom: true }];
    if (spec.readOnly !== true) {
      this.config.editableColumns = [...(this.config.editableColumns ?? []), name];
    }
    this.rebuildColumns();
    this.rebuild();
    this.emit("column-change", { columns: this.listColumns(), added: name });
  }

  /**
   * Delete a column. A column added with `addColumn()` never reached ENA, so
   * it goes with its values and its edits. A report field is a field of the
   * record: deleting it clears it in every row, which reaches the change set
   * (and the host's MODIFY manifest) like any other edit — whether ENA allows
   * the field to be cleared is ENA's answer to give.
   */
  removeColumn(name: string): void {
    const spec = this.specFor(name);
    if (!spec || isControlColumn(name)) return;
    if (spec.custom) {
      this.config.columns = (this.config.columns ?? []).filter((s) => s.name !== name);
      this.config.editableColumns = (this.config.editableColumns ?? []).filter((n) => n !== name);
      this.tracker.dropColumn(name);
      // Also out of the data, or mergeColumns() re-derives it from the rows.
      for (const row of this.rows) delete row[name];
      for (const row of this.original.values()) delete row[name];
    } else {
      for (const row of this.rows) {
        const key = rowKey(this.config.entity, row);
        const accession = typeof row["accession"] === "string" ? row["accession"] : key;
        this.tracker.record(key, name, row[name], "", accession);
      }
    }
    this.deleted.push(name);
    this.order = this.order.filter((n) => n !== name);
    this.pinned = this.pinned.filter((n) => n !== name);
    this.hidden = this.hidden.filter((n) => n !== name);
    delete this.widths[name];
    this.rebuildColumns();
    this.rebuild();
    this.emit("column-change", { columns: this.listColumns(), removed: name });
    this.emit("change", { changes: this.getChangeSet() });
  }

  /** The config as the grid now holds it — `addColumn()` mutates it. */
  getConfig(): EnaBrowserConfig {
    return { ...this.config };
  }

  private customColumn(name: string): Handsontable.ColumnSettings {
    const spec = this.customSpecs.find((s) => s.name === name);
    const map = this.customValues.get(name);
    const editable = this.isEditable(name);
    const accessor = (row: Row, value?: unknown): unknown => {
      const key = rowKey(this.config.entity, row);
      if (value === undefined) return map?.get(key) ?? spec?.default ?? null;
      map?.set(key, value);
      return undefined;
    };
    return {
      data: accessor as Handsontable.ColumnSettings["data"],
      title: spec?.title ?? name,
      type: spec?.type === "numeric" ? "numeric" : (spec?.type ?? "text"),
      width: this.widths[name],
      readOnly: !editable,
      className: spec?.render === "badge" ? "ena-browser-badge" : undefined,
      renderer:
        spec?.render === "badge"
          ? (_instance, td, _row, _col, _prop, value) => {
              td.textContent = "";
              const badge = document.createElement("span");
              badge.className = "ena-browser-badge-value";
              const shown = value ?? spec.default ?? 0;
              badge.dataset["zero"] = String(!shown);
              badge.textContent = String(shown);
              td.appendChild(badge);
            }
          : undefined,
    };
  }

  private settings(): Handsontable.GridSettings {
    const columns = this.hotColumns();
    this.active = this.displayOrder();
    // The control columns are always frozen, ahead of the user's pins.
    const controlOffset = this.displayOrder().filter(isControlColumn).length;
    return {
      data: this.rows,
      columns,
      themeName: themeName(this.resolvedTheme),
      colHeaders: columns.map((c) => String(c.title ?? "")),
      rowHeaders: false,
      filters: true,
      // The filter UI only — the default menu's insert/remove column items
      // make no sense for a report view.
      dropdownMenu: [
        "filter_by_condition",
        "filter_operators",
        "filter_by_condition2",
        "filter_by_value",
        "filter_action_bar",
      ],
      multiColumnSorting: true,
      manualColumnMove: true,
      manualColumnResize: true,
      hiddenColumns: { columns: this.hiddenIndices(), indicators: true },
      fixedColumnsStart: controlOffset + this.pinned.length,
      contextMenu: this.contextMenu(),
      licenseKey: this.config.license ?? DEFAULT_LICENSE,
      stretchH: "last",
      autoWrapRow: false,
      height: this.config.height ?? "100%",
      className: "ena-browser-table",
      // `cells` is handed a *physical* row index, unlike the hooks below,
      // which are visual — see sourceRow(). Covered by edit.spec.ts's
      // dirty-cell test, which sorts before editing.
      cells: (row, _col, prop) => {
        const name = typeof prop === "string" ? prop : "";
        const data = this.rows[row];
        if (!name || !data) return {};
        const key = rowKey(this.config.entity, data);
        return this.tracker.hasChange(key, name) ? { className: "ena-browser-dirty" } : {};
      },
      afterChange: (changes, source) => this.onAfterChange(changes, source),
      afterFilter: () => this.onFilterOrSort(),
      afterColumnSort: (_prev, current) => {
        this.sort = current.map((entry) => ({
          column: this.active[entry.column] ?? "",
          order: entry.sortOrder === "desc" ? "desc" : "asc",
        }));
        this.onFilterOrSort();
      },
      afterColumnMove: () => this.onColumnMove(),
      afterColumnResize: (size, column) => {
        const name = this.active[column];
        if (name) this.widths[name] = size;
        this.emit("layout-change", { layout: this.getLayout() });
      },
      afterOnCellMouseDown: (_event, coords) => {
        if (coords.row < 0) return;
        const data = this.sourceRow(coords.row);
        if (!data) return;
        const key = rowKey(this.config.entity, data);
        const name = this.active[coords.col];
        if (
          this.config.selectionMode === "single" &&
          name !== SELECTION_COLUMN &&
          name !== ACTIONS_COLUMN
        ) {
          this.setRowSelected(key, true);
        }
      },
    };
  }

  private hiddenIndices(): number[] {
    const order = this.displayOrder();
    return this.hidden.map((name) => order.indexOf(name)).filter((index) => index >= 0);
  }

  private contextMenu(): Handsontable.GridSettings["contextMenu"] {
    const columnAt = (): string | null => {
      const selection = this.hot?.getSelectedLast();
      return selection ? (this.active[selection[1]] ?? null) : null;
    };
    return {
      items: {
        pin: {
          name: () => {
            const name = columnAt();
            return name && this.pinned.includes(name) ? "Unpin column" : "Pin column";
          },
          callback: () => {
            const name = columnAt();
            if (!name || isControlColumn(name)) return;
            if (this.pinned.includes(name)) this.unpin(name);
            else this.pin(name);
          },
        },
        hide: {
          name: () => "Hide column",
          callback: () => {
            const name = columnAt();
            if (name && !isControlColumn(name)) this.hideColumn(name);
          },
        },
        show_all: {
          name: () => "Show all columns",
          callback: () => this.showAllColumns(),
        },
      },
    };
  }

  private rebuild(): void {
    if (!this.hot || this.rebuilding) return;
    this.rebuilding = true;
    try {
      this.hot.updateSettings(this.settings());
      this.applyFiltersToGrid();
    } finally {
      this.rebuilding = false;
    }
  }

  // -------------------------------------------------------------------- rows

  private snapshot(): void {
    this.original.clear();
    for (const row of this.rows) {
      this.original.set(rowKey(this.config.entity, row), { ...row });
    }
  }

  setRows(rows: Row[]): void {
    this.rows = [...rows];
    this.snapshot();
    this.tracker.clear();
    this.selected = this.selected.filter((key) =>
      this.rows.some((row) => rowKey(this.config.entity, row) === key),
    );
    this.rebuildColumns();
    this.rebuild();
    this.onFilterOrSort();
  }

  getRows(): Row[] {
    return [...this.rows];
  }

  private rowFor(key: string): Row | undefined {
    return this.rows.find((candidate) => rowKey(this.config.entity, candidate) === key);
  }

  setEntity(entity: Entity): void {
    this.config.entity = entity;
    this.statusSpec = statusFilterToSpec(this.config.statusFilter, entity);
    this.rebuildColumns();
    this.rebuild();
  }

  /** Every filter currently in force: status toggles, quick filter, explicit. */
  allFilters(): FilterSpec[] {
    const specs = [...this.userFilters];
    if (this.statusSpec) specs.push(this.statusSpec);
    return specs;
  }

  private quickMatch(row: Row): boolean {
    if (this.quickFilter === "") return true;
    const spec: FilterSpec = {
      column: "",
      operator: "contains",
      value: this.quickFilter,
    };
    return this.visibleTextColumns().some((column) => matchesFilter(row, { ...spec, column }));
  }

  private visibleTextColumns(): string[] {
    return this.displayOrder().filter(
      (name) => name !== SELECTION_COLUMN && !this.isCustom(name) && !this.hidden.includes(name),
    );
  }

  /**
   * Rows passing the filters, in display order. Uses the JS evaluator rather
   * than Handsontable's row map so it behaves identically headless.
   */
  getVisibleRows(): Row[] {
    const rows = applyFilters(this.rows, this.allFilters()).filter((row) => this.quickMatch(row));
    if (this.sort.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const spec of this.sort) {
        const direction = spec.order === "desc" ? -1 : 1;
        const result = String(a[spec.column] ?? "").localeCompare(String(b[spec.column] ?? ""));
        if (result !== 0) return result * direction;
      }
      return 0;
    });
  }

  // ----------------------------------------------------------------- filters

  setFilters(specs: FilterSpec[]): void {
    this.userFilters = [...specs];
    this.applyFiltersToGrid();
    this.onFilterOrSort();
  }

  getFilters(): FilterSpec[] {
    return [...this.userFilters];
  }

  setStatusFilter(spec: EnaBrowserConfig["statusFilter"]): void {
    this.config.statusFilter = spec;
    this.statusSpec = statusFilterToSpec(spec, this.config.entity);
    this.applyFiltersToGrid();
    this.onFilterOrSort();
  }

  setQuickFilter(text: string): void {
    this.quickFilter = text.trim();
    this.applyFiltersToGrid();
    this.onFilterOrSort();
  }

  setSort(specs: SortSpec[]): void {
    this.sort = [...specs];
    this.applySortToGrid();
    this.onFilterOrSort();
  }

  getSort(): SortSpec[] {
    return [...this.sort];
  }

  private distinctValues(column: string): unknown[] {
    return [...new Set(this.rows.map((row) => row[column]))];
  }

  private applyFiltersToGrid(): void {
    const plugin = this.hot?.getPlugin("filters");
    if (!plugin) return;
    plugin.clearConditions();
    for (const spec of this.allFilters()) {
      const index = this.active.indexOf(spec.column);
      if (index < 0) continue;
      const condition = toHandsontableCondition(
        spec,
        spec.operator === "not_in" ? this.distinctValues(spec.column) : undefined,
      );
      plugin.addCondition(index, condition.name, condition.args);
    }
    if (this.quickFilter !== "") {
      // One `contains` per column OR-ed together is not expressible in the
      // plugin's per-column stack, so the quick filter is applied as a `by_value`
      // list on the row-key column instead.
      const keys = this.rows
        .filter((row) => this.quickMatch(row))
        .map((row) => row[this.keyColumn()]);
      const index = this.active.indexOf(this.keyColumn());
      if (index >= 0) plugin.addCondition(index, "by_value", [keys]);
    }
    plugin.filter();
  }

  private keyColumn(): string {
    const first = this.rows[0];
    if (!first) return "accession";
    for (const name of ["accession", "secondary_accession", "alias"]) {
      if (typeof first[name] === "string" && first[name] !== "") return name;
    }
    return this.order[0] ?? "accession";
  }

  private applySortToGrid(): void {
    const plugin = this.hot?.getPlugin("multiColumnSorting");
    if (!plugin) return;
    const configs = this.sort
      .map((spec) => ({
        column: this.active.indexOf(spec.column),
        sortOrder: spec.order,
      }))
      .filter((entry) => entry.column >= 0);
    if (configs.length === 0) plugin.clearSort();
    else plugin.sort(configs);
  }

  private onFilterOrSort(): void {
    this.emit("filter-change", {
      filters: this.uiFilters(),
      sort: this.getSort(),
      visibleCount: this.getVisibleRows().length,
    });
  }

  /** What the user has in the dropdowns, in FilterSpec vocabulary. */
  private uiFilters(): FilterSpec[] {
    const plugin = this.hot?.getPlugin("filters");
    if (!plugin) return this.getFilters();
    const stack: ColumnConditions[] = plugin.exportConditions();
    return fromHandsontableConditions(
      stack.map((entry) => ({
        column: entry.column,
        conditions: entry.conditions.map((condition) => ({
          name: condition.name ?? condition.command?.key ?? "",
          args: condition.args,
        })),
      })),
      this.active,
    );
  }

  // ------------------------------------------------------------------ layout

  pin(column: string): void {
    if (isControlColumn(column) || this.pinned.includes(column)) return;
    this.pinned.push(column);
    this.rebuild();
    this.emit("layout-change", { layout: this.getLayout() });
  }

  unpin(column: string): void {
    if (!this.pinned.includes(column)) return;
    this.pinned = this.pinned.filter((name) => name !== column);
    this.rebuild();
    this.emit("layout-change", { layout: this.getLayout() });
  }

  hideColumn(column: string): void {
    if (this.hidden.includes(column)) return;
    this.hidden.push(column);
    this.rebuild();
    this.emit("layout-change", { layout: this.getLayout() });
  }

  showColumn(column: string): void {
    this.hidden = this.hidden.filter((name) => name !== column);
    this.rebuild();
    this.emit("layout-change", { layout: this.getLayout() });
  }

  showAllColumns(): void {
    this.hidden = [];
    this.rebuild();
    this.emit("layout-change", { layout: this.getLayout() });
  }

  isPinned(column: string): boolean {
    return this.pinned.includes(column);
  }

  isHidden(column: string): boolean {
    return this.hidden.includes(column);
  }

  /** Data columns, in display order — what the toolbar's Columns menu lists. */
  listColumns(): ColumnSpec[] {
    return this.displayOrder()
      .filter((name) => !isControlColumn(name))
      .map((name) => this.specFor(name))
      .filter((spec): spec is ColumnSpec => spec !== undefined);
  }

  /**
   * Reorder the data columns to `names` — what the toolbar's Columns menu
   * hands back after a drag. Same semantics as dragging a header.
   */
  setColumnOrder(names: string[]): void {
    const moved = names.filter((name) => !isControlColumn(name) && this.specFor(name));
    if (moved.length !== this.order.length) return;
    this.applyColumnOrder(moved);
    this.rebuild();
  }

  private onColumnMove(): void {
    if (!this.hot || this.rebuilding) return;
    const count = this.hot.countCols();
    const moved: string[] = [];
    for (let visual = 0; visual < count; visual += 1) {
      const name = this.active[this.hot.toPhysicalColumn(visual)];
      if (name && !isControlColumn(name)) moved.push(name);
    }
    this.applyColumnOrder(moved);
  }

  private applyColumnOrder(moved: string[]): void {
    // Pins keep their leading positions; anything dragged out of the pinned
    // block stops being pinned.
    const pinCount = this.pinned.length;
    this.pinned = moved.slice(0, pinCount).filter((name) => this.pinned.includes(name));
    this.order = moved;
    this.emit("layout-change", { layout: this.getLayout() });
  }

  getLayout(): Layout {
    return {
      order: [...this.order],
      pinned: [...this.pinned],
      hidden: [...this.hidden],
      widths: { ...this.widths },
    };
  }

  setLayout(layout: Layout): void {
    this.applyLayout(layout);
    this.rebuild();
  }

  private applyLayout(layout: Layout): void {
    const known = this.columns.map((c) => c.name);
    const keep = (names: string[] | undefined): string[] =>
      (names ?? []).filter((name) => known.length === 0 || known.includes(name));
    if (layout.order) this.order = keep(layout.order);
    if (layout.pinned) this.pinned = keep(layout.pinned);
    if (layout.hidden) this.hidden = keep(layout.hidden);
    if (layout.widths) this.widths = { ...layout.widths };
  }

  // --------------------------------------------------------------- selection

  private setRowSelected(key: string, selected: boolean): void {
    if (key === "") return;
    if (this.config.selectionMode === "single") {
      this.selected = selected ? [key] : [];
    } else if (selected) {
      if (!this.selected.includes(key)) this.selected.push(key);
    } else {
      this.selected = this.selected.filter((k) => k !== key);
    }
    this.lastKey = selected ? key : null;
    this.hot?.render();
    this.emitSelection();
  }

  private emitSelection(): void {
    this.emit("selection-change", {
      keys: [...this.selected],
      rows: this.selectedRows(),
      lastKey: this.lastKey,
    });
  }

  private selectedRows(): Row[] {
    const byKey = new Map(this.rows.map((row) => [rowKey(this.config.entity, row), row]));
    return this.selected
      .map((key) => byKey.get(key))
      .filter((row): row is Row => row !== undefined);
  }

  getSelection(): string[] {
    return [...this.selected];
  }

  setSelection(keys: string[]): void {
    this.selected = this.config.selectionMode === "single" ? keys.slice(0, 1) : [...keys];
    this.lastKey = this.selected.at(-1) ?? null;
    this.hot?.render();
    this.emitSelection();
  }

  clearSelection(): void {
    this.selected = [];
    this.lastKey = null;
    this.hot?.render();
    this.emitSelection();
  }

  // ---------------------------------------------------------- custom columns

  /**
   * Merge values into a custom column and repaint.
   *
   * ponytail: `render()` repaints the viewport only and keeps sort, filters,
   * scroll and selection — which is the actual requirement. Per-cell repaint
   * would need Handsontable internals; revisit if profiling ever says so.
   */
  setCustomValues(column: string, values: Record<string, unknown> | Map<string, unknown>): void {
    const map = this.customValues.get(column);
    if (!map) throw new Error(`unknown custom column: ${column}`);
    const entries = values instanceof Map ? values.entries() : Object.entries(values);
    for (const [key, value] of entries) map.set(key, value);
    this.hot?.render();
  }

  getCustomValues(column: string): Map<string, unknown> {
    return new Map(this.customValues.get(column) ?? []);
  }

  // -------------------------------------------------------------------- edit

  setMode(mode: EnaBrowserConfig["mode"]): void {
    this.config.mode = mode;
    this.rebuild();
  }

  getMode(): EnaBrowserConfig["mode"] {
    return this.config.mode ?? "read";
  }

  private onAfterChange(
    changes: Handsontable.CellChange[] | null,
    source: Handsontable.ChangeSource,
  ): void {
    if (!changes || source !== "edit") return;
    let tracked = false;
    for (const [visualRow, prop, oldValue, newValue] of changes) {
      if (typeof prop !== "string") continue; // accessor columns: not row data
      const row = this.sourceRow(visualRow);
      if (!row) continue;
      const key = rowKey(this.config.entity, row);
      const accession = typeof row["accession"] === "string" ? row["accession"] : key;
      this.tracker.record(key, prop, oldValue, newValue, accession);
      tracked = true;
    }
    if (!tracked) return;
    this.hot?.render();
    this.emit("change", { changes: this.getChangeSet() });
  }

  /** Pending edits, minus the rows unticked in the include column. */
  getChangeSet(): ChangeSet {
    return { rows: this.tracker.get().rows.filter((row) => !this.excluded.has(row.key)) };
  }

  get pendingCount(): number {
    return this.getChangeSet().rows.length;
  }

  clearChanges(): void {
    this.tracker.clear();
    this.hot?.render();
  }

  /**
   * Replace the pending edits wholesale: rewind every currently-edited cell
   * to its original value, then replay `changes`. Idempotent, so a host's
   * undo/redo stack can hand back any earlier `ChangeSet` and get exactly
   * that state — no per-cell replay, no drift.
   */
  setEdits(changes: RowChange[]): void {
    this.rewindEdits();
    const applicable = changes.filter((change) => this.rowFor(change.key) !== undefined);
    for (const change of applicable) {
      const row = this.rowFor(change.key) as Row;
      for (const column of change.changed) row[column] = change.after[column];
    }
    this.tracker.restore(applicable);
    this.hot?.render();
    this.emit("change", { changes: this.getChangeSet() });
  }

  private rewindEdits(): void {
    for (const change of this.tracker.get().rows) {
      const row = this.rowFor(change.key);
      const before = this.original.get(change.key);
      if (!row || !before) continue;
      for (const column of change.changed) row[column] = before[column];
    }
  }

  /** One JSON-safe snapshot of everything the user can change. */
  getState(): BrowserState {
    return {
      // Every tracked edit, excluded rows included — `excluded` is state too.
      edits: this.tracker.get().rows,
      layout: this.getLayout(),
      filters: this.getFilters(),
      sort: this.getSort(),
      selection: this.getSelection(),
      excluded: this.getExcluded(),
    };
  }

  /**
   * Restore a snapshot. Events fired while restoring carry `source: "api"` so
   * a host stack can ignore them instead of pushing what it just replayed.
   */
  setState(state: Partial<BrowserState>): void {
    this.applying = true;
    try {
      if (state.layout) this.setLayout(state.layout);
      if (state.filters) this.setFilters(state.filters);
      if (state.sort) this.setSort(state.sort);
      if (state.edits) this.setEdits(state.edits);
      if (state.excluded) this.setExcluded(state.excluded);
      if (state.selection) this.setSelection(state.selection);
    } finally {
      this.applying = false;
    }
  }

  /** Restore every edited cell to its pre-edit value and forget the changes. */
  discardChanges(): void {
    this.rewindEdits();
    this.tracker.clear();
    // Deleting a report field was one of those edits, so the column comes back.
    this.deleted = [];
    this.rebuildColumns();
    this.rebuild();
    this.emit("change", { changes: this.getChangeSet() });
  }

  emitRowAction(action: string, key: string): void {
    const row = this.rowFor(key);
    if (row) this.emit("row-action", { action, key, row });
  }
}

/** The columns the grid owns itself: they are controls, never data. */
function isControlColumn(name: string): boolean {
  return name === SELECTION_COLUMN || name === ACTIONS_COLUMN || name === INCLUDE_COLUMN;
}

export { ACTIONS_COLUMN, INCLUDE_COLUMN, SELECTION_COLUMN };
