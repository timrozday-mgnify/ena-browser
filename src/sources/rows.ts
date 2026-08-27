import type { DataSource, Row } from "../types.js";

/** The trivial source, for hosts that already have the data. */
export function rowsSource(rows: Row[]): DataSource {
  return { fetch: async () => [...rows] };
}
