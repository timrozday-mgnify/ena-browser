/** Edit tracking: what changed, per row, since the last `clear()`. */

import type { ChangeSet, Row, RowChange } from "./types.js";

/** Columns whose value differs between two versions of a row. */
export function diffRow(before: Row, after: Row, editableColumns: string[]): { changed: string[] } {
  const changed = editableColumns.filter((column) => !same(before[column], after[column]));
  return { changed };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const ea = a === null || a === undefined || a === "";
  const eb = b === null || b === undefined || b === "";
  if (ea && eb) return true;
  return String(a) === String(b);
}

interface TrackedRow {
  accession: string;
  before: Row;
  after: Row;
}

/**
 * Accumulates cell edits into a `ChangeSet`.
 *
 * Reverting a cell to its original value removes it again — no-op
 * modifications must never reach ENA.
 */
export class ChangeTracker {
  private rows = new Map<string, TrackedRow>();

  record(key: string, column: string, oldValue: unknown, newValue: unknown, accession = key): void {
    let tracked = this.rows.get(key);
    if (!tracked) {
      tracked = { accession, before: {}, after: {} };
      this.rows.set(key, tracked);
    }
    if (!(column in tracked.before)) tracked.before[column] = oldValue;

    if (same(tracked.before[column], newValue)) {
      delete tracked.before[column];
      delete tracked.after[column];
    } else {
      tracked.after[column] = newValue;
    }

    if (Object.keys(tracked.after).length === 0) this.rows.delete(key);
  }

  /** Every edit this row has pending, or `[]`. */
  changedColumns(key: string): string[] {
    return Object.keys(this.rows.get(key)?.after ?? {});
  }

  hasChange(key: string, column: string): boolean {
    return column in (this.rows.get(key)?.after ?? {});
  }

  get size(): number {
    return this.rows.size;
  }

  get(): ChangeSet {
    const rows: RowChange[] = [...this.rows.entries()].map(([key, tracked]) => ({
      key,
      accession: tracked.accession,
      before: { ...tracked.before },
      after: { ...tracked.after },
      changed: Object.keys(tracked.after),
    }));
    return { rows };
  }

  /**
   * Replace the whole pending set — how a host's undo/redo stack rewinds to
   * an earlier `ChangeSet` without replaying the edits cell by cell.
   */
  restore(rows: RowChange[]): void {
    this.rows.clear();
    for (const change of rows) {
      this.rows.set(change.key, {
        accession: change.accession,
        before: { ...change.before },
        after: { ...change.after },
      });
    }
  }

  /** Forget every edit to one column — what deleting that column means. */
  dropColumn(column: string): void {
    for (const [key, tracked] of this.rows) {
      delete tracked.before[column];
      delete tracked.after[column];
      if (Object.keys(tracked.after).length === 0) this.rows.delete(key);
    }
  }

  clear(): void {
    this.rows.clear();
  }
}
