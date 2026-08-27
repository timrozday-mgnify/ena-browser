/**
 * Filter specs, their translation to/from Handsontable's `Filters` plugin
 * conditions, and a plain-JS evaluator.
 *
 * The grid does the real filtering; the evaluator exists so `getVisibleRows()`
 * and the unit tests work without a DOM.
 */

import { STATUS, normalizeStatus } from "./entities.js";
import type { Entity, FilterSpec, Row, StatusFilterSpec } from "./types.js";

export interface HandsontableCondition {
  name: string;
  args: unknown[];
}

const TO_HOT: Record<string, string> = {
  eq: "eq",
  neq: "neq",
  contains: "contains",
  not_contains: "not_contains",
  begins: "begins_with",
  ends: "ends_with",
  in: "by_value",
  not_in: "by_value",
  empty: "empty",
  not_empty: "not_empty",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  between: "between",
};

const FROM_HOT: Record<string, FilterSpec["operator"]> = {
  eq: "eq",
  neq: "neq",
  contains: "contains",
  not_contains: "not_contains",
  begins_with: "begins",
  ends_with: "ends",
  by_value: "in",
  empty: "empty",
  not_empty: "not_empty",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  between: "between",
};

/**
 * Translate one spec into a Handsontable condition.
 *
 * ponytail: Handsontable has no `not_in`; pass `columnValues` (the distinct
 * values in that column) and it becomes a `by_value` over the complement. Without
 * them the exclusion cannot be expressed and an empty `by_value` list is returned,
 * which the caller should treat as "filter in JS instead".
 */
export function toHandsontableCondition(
  spec: FilterSpec,
  columnValues?: unknown[],
): HandsontableCondition {
  const name = TO_HOT[spec.operator];
  if (!name) throw new Error(`unsupported filter operator: ${spec.operator}`);

  if (spec.operator === "in") return { name, args: [spec.values ?? []] };
  if (spec.operator === "not_in") {
    const excluded = new Set((spec.values ?? []).map(String));
    const kept = (columnValues ?? []).filter((v) => !excluded.has(String(v)));
    return { name, args: [kept] };
  }
  if (spec.operator === "empty" || spec.operator === "not_empty") {
    return { name, args: [] };
  }
  if (spec.operator === "between") {
    const [min, max] = sortedBounds(spec);
    return { name, args: [min, max] };
  }
  return { name, args: [spec.value] };
}

/** A Handsontable filter stack entry, as `afterFilter` hands it over. */
export interface HandsontableFilterStackEntry {
  column: number;
  conditions: HandsontableCondition[];
}

/**
 * Turn Handsontable's filter stack back into specs, so `filter-change` reports
 * dropdown-driven filters in the same vocabulary the host passes in.
 */
export function fromHandsontableConditions(
  stack: HandsontableFilterStackEntry[],
  columnNames: string[],
): FilterSpec[] {
  const specs: FilterSpec[] = [];
  for (const entry of stack) {
    const column = columnNames[entry.column];
    if (column === undefined) continue;
    for (const condition of entry.conditions) {
      const operator = FROM_HOT[condition.name];
      if (!operator) continue;
      if (operator === "in") {
        const values = condition.args[0];
        specs.push({
          column,
          operator,
          values: Array.isArray(values) ? values : [],
        });
      } else if (operator === "between") {
        specs.push({
          column,
          operator,
          values: [condition.args[0], condition.args[1]],
        });
      } else if (operator === "empty" || operator === "not_empty") {
        specs.push({ column, operator });
      } else {
        specs.push({ column, operator, value: condition.args[0] });
      }
    }
  }
  return specs;
}

/** "Hide cancelled / suppressed" as an ordinary filter spec. */
export function statusFilterToSpec(
  statusFilter: StatusFilterSpec | undefined,
  _entity: Entity,
): FilterSpec | null {
  const spec = statusFilter ?? {};
  if (spec.include && spec.include.length > 0) {
    return {
      column: "status",
      operator: "in",
      values: spec.include.map((s) => s.toUpperCase()),
    };
  }
  const excluded: string[] = [];
  if (spec.excludeCancelled !== false) excluded.push(STATUS.CANCELLED);
  if (spec.excludeSuppressed !== false) excluded.push(STATUS.SUPPRESSED);
  if (excluded.length === 0) return null;
  return { column: "status", operator: "not_in", values: excluded };
}

function sortedBounds(spec: FilterSpec): [unknown, unknown] {
  const [a, b] = spec.values ?? [];
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na > nb) return [b, a];
  if (typeof a === "string" && typeof b === "string" && !Number.isFinite(na) && a > b) {
    return [b, a];
  }
  return [a, b];
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function compare(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && text(a) !== "" && text(b) !== "") {
    return na - nb;
  }
  return text(a).localeCompare(text(b));
}

/** Does one row pass one spec? */
export function matchesFilter(row: Row, spec: FilterSpec): boolean {
  // `status` is compared case-insensitively; ENA's vocabulary is upper-case.
  const raw = spec.column === "status" ? normalizeStatus(row) : row[spec.column];
  const value = text(raw);
  const lower = value.toLowerCase();
  const needle = text(spec.value).toLowerCase();
  const list = (spec.values ?? []).map((v) => text(v).toLowerCase());

  switch (spec.operator) {
    case "eq":
      return lower === needle;
    case "neq":
      return lower !== needle;
    case "contains":
      return lower.includes(needle);
    case "not_contains":
      return !lower.includes(needle);
    case "begins":
      return lower.startsWith(needle);
    case "ends":
      return lower.endsWith(needle);
    case "in":
      return list.includes(lower);
    case "not_in":
      return !list.includes(lower);
    case "empty":
      return value === "";
    case "not_empty":
      return value !== "";
    case "gt":
      return compare(raw, spec.value) > 0;
    case "gte":
      return compare(raw, spec.value) >= 0;
    case "lt":
      return compare(raw, spec.value) < 0;
    case "lte":
      return compare(raw, spec.value) <= 0;
    case "between": {
      const [min, max] = sortedBounds(spec);
      return compare(raw, min) >= 0 && compare(raw, max) <= 0;
    }
    default:
      return true;
  }
}

/** Rows passing every spec (specs are AND-ed, as Handsontable AND-s them). */
export function applyFilters(rows: Row[], specs: FilterSpec[]): Row[] {
  if (specs.length === 0) return [...rows];
  return rows.filter((row) => specs.every((spec) => matchesFilter(row, spec)));
}
