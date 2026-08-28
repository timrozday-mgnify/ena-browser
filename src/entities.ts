/**
 * Per-entity defaults: which field identifies a row, which columns show by
 * default, and the ENA status vocabulary.
 *
 * Source of truth for the field names and statuses is
 * `ena-api-client/ena_api/models.py` (Reports API models, `extra="allow"`).
 * They are data, not code — mirrored here deliberately, not imported.
 */

import type { ColumnSpec, CustomColumnSpec, Entity, Row } from "./types.js";

export const STATUS = {
  CANCELLED: "CANCELLED",
  SUPPRESSED: "SUPPRESSED",
  PRIVATE: "PRIVATE",
  PUBLIC: "PUBLIC",
  DRAFT: "DRAFT",
} as const;

/** Upper-cased `row.status`, or `""` when absent. */
export function normalizeStatus(row: Row): string {
  const status = row["status"];
  return typeof status === "string" ? status.toUpperCase() : "";
}

/**
 * The value identifying a row. Reports rows are inconsistent about which
 * accession they carry, hence the fallback chain rather than a constant.
 */
export function rowKey(_entity: Entity, row: Row): string {
  for (const field of ["accession", "secondary_accession", "alias"]) {
    const value = row[field];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

export const DEFAULT_COLUMNS: Record<Entity, string[]> = {
  studies: ["accession", "secondary_accession", "alias", "title", "status"],
  samples: ["accession", "secondary_accession", "alias", "title", "status"],
  runs: [
    "accession",
    "alias",
    "experiment_accession",
    "study_accession",
    "sample_accession",
    "status",
    // Registration and file archival are separate events: `status` is the
    // release status, `process_status` is whether ENA has finished processing
    // the reads. The host fills it from the run-processing report.
    "process_status",
  ],
  experiments: ["accession", "alias", "title", "study_accession", "sample_accession", "status"],
  analyses: ["accession", "alias", "title", "study_accession", "status"],
  // files carry no stable shape — derived from the data below
  files: [],
};

/** `snake_case` → `Snake case`, for a column with no explicit title. */
export function titleFor(name: string): string {
  const spaced = name.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Entity defaults, then config overrides, then any extra keys present in the
 * data (Reports rows carry `extra="allow"` fields — dropping them silently is
 * the bug this exists to prevent), then custom columns last.
 *
 * A data-derived extra starts hidden: the entity's `DEFAULT_COLUMNS` are what
 * a fresh grid shows, and everything else the API happened to send is there in
 * the columns menu to be ticked on. Entities with no defaults (`files`, whose
 * shape is entirely data-derived) are exempt — hiding every column would leave
 * an empty grid.
 */
export function mergeColumns(
  entity: Entity,
  rows: Row[],
  configColumns: ColumnSpec[] = [],
  customColumns: CustomColumnSpec[] = [],
): ColumnSpec[] {
  const merged = new Map<string, ColumnSpec>();
  const add = (spec: ColumnSpec): void => {
    const existing = merged.get(spec.name);
    merged.set(spec.name, existing ? { ...existing, ...spec } : spec);
  };

  const defaults = DEFAULT_COLUMNS[entity];
  for (const name of defaults) add({ name });
  for (const spec of configColumns) add(spec);
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!merged.has(name)) add({ name, type: "text", hidden: defaults.length > 0 });
    }
  }
  for (const spec of customColumns) {
    add({
      name: spec.name,
      title: spec.title,
      type: spec.type ?? "text",
      readOnly: spec.readOnly ?? true,
      // A custom column is the host's point of adding it, never a hidden extra
      // — even when a report row happens to carry the same field name.
      hidden: false,
    });
  }

  return [...merged.values()].map((spec) => ({
    ...spec,
    title: spec.title ?? titleFor(spec.name),
    type: spec.type ?? "text",
  }));
}
