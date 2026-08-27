/**
 * The public API surface. Every type a consumer codes against lives here;
 * no other module exports types.
 */

export type Mode = "read" | "edit";
export type SelectionMode = "none" | "single" | "multi";
export type Entity = "studies" | "samples" | "runs" | "experiments" | "analyses" | "files";

/** A plain report row as it arrives from the Reports API. */
export type Row = Record<string, unknown>;

export type ColumnType = "text" | "numeric" | "checkbox" | "date";

export interface ColumnSpec {
  name: string;
  title?: string;
  type?: ColumnType;
  width?: number;
  readOnly?: boolean;
  hidden?: boolean;
}

export interface CustomColumnSpec {
  name: string;
  title: string;
  type?: "numeric" | "text" | "checkbox";
  /** Custom columns are pinned by default — they are the point. */
  pinned?: boolean;
  /** The host owns the values, so read-only by default. */
  readOnly?: boolean;
  default?: unknown;
  render?: "badge" | "text";
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "begins"
  | "ends"
  | "in"
  | "not_in"
  | "empty"
  | "not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between";

export interface FilterSpec {
  column: string;
  operator: FilterOperator;
  value?: unknown;
  /** for in / not_in / between */
  values?: unknown[];
}

export interface StatusFilterSpec {
  /** explicit allow-list of ENA status values */
  include?: string[];
  /** default true */
  excludeCancelled?: boolean;
  /** default true */
  excludeSuppressed?: boolean;
}

export interface SortSpec {
  column: string;
  order: "asc" | "desc";
}

export interface RowActionSpec {
  /** identifier echoed back in the `row-action` event */
  action: string;
  label: string;
  title?: string;
}

export interface Layout {
  /** column names, in display order */
  order?: string[];
  /** column names pinned to the start, in pin order */
  pinned?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

export interface RowChange {
  key: string;
  accession: string;
  before: Row;
  after: Row;
  changed: string[];
}

export interface ChangeSet {
  rows: RowChange[];
}

export interface DataSource {
  fetch(opts: { entity: Entity; signal: AbortSignal }): Promise<Row[]>;
}

export interface EnaBrowserConfig {
  entity: Entity;
  mode?: Mode;
  rows?: Row[];
  source?: DataSource;
  columns?: ColumnSpec[];
  customColumns?: CustomColumnSpec[];
  filters?: FilterSpec[];
  sort?: SortSpec[];
  statusFilter?: StatusFilterSpec;
  selectionMode?: SelectionMode;
  editableColumns?: string[];
  rowActions?: RowActionSpec[];
  layout?: Layout;
  height?: number | string;
  /** Handsontable licenseKey passthrough. */
  license?: string;
}

/** `detail` payloads of the `ena-browser:*` CustomEvents. */
export interface EnaBrowserEventMap {
  ready: Record<string, never>;
  "selection-change": { keys: string[]; rows: Row[]; lastKey: string | null };
  change: { changes: ChangeSet };
  "row-action": { action: string; key: string; row: Row };
  "filter-change": {
    filters: FilterSpec[];
    sort: SortSpec[];
    visibleCount: number;
  };
  "layout-change": { layout: Layout };
  error: { message: string };
}
