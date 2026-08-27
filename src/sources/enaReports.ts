/**
 * Optional adapter: the ENA Webin Reports API, called straight from the
 * browser with Basic auth. Used by `demo/` and the standalone app; hosts with
 * a backend of their own pass rows instead.
 *
 * Hosts and paths mirror `ena-api-client/ena_api/config.py` and
 * `ena_api/reports.py` — test and production differ.
 */

import type { DataSource, Entity, Row } from "../types.js";

const PROD_HOST = "www.ebi.ac.uk";
const TEST_HOST = "wwwdev.ebi.ac.uk";
const DEFAULT_MAX_RESULTS = 1000;

/** Reports API path segment per entity — `studies` is `projects` at ENA. */
const ENDPOINT: Record<Entity, string> = {
  studies: "projects",
  samples: "samples",
  runs: "runs",
  experiments: "experiments",
  analyses: "analyses",
  files: "files",
};

export interface EnaReportsSourceOptions {
  username: string;
  password: string;
  /** Target the ENA test service. Ignored when `baseUrl` is given. */
  test?: boolean;
  /** Override the whole base, e.g. a same-origin proxy. */
  baseUrl?: string;
  maxResults?: number;
}

export function reportsBaseUrl(test = false): string {
  return `https://${test ? TEST_HOST : PROD_HOST}/ena/submit/report`;
}

export function enaReportsSource(options: EnaReportsSourceOptions): DataSource {
  const base = options.baseUrl ?? reportsBaseUrl(options.test);
  const auth = btoa(`${options.username}:${options.password}`);

  return {
    async fetch({ entity, signal }): Promise<Row[]> {
      const url = new URL(`${base}/${ENDPOINT[entity]}`);
      url.searchParams.set("format", "json");
      url.searchParams.set("max-results", String(options.maxResults ?? DEFAULT_MAX_RESULTS));

      let response: Response;
      try {
        response = await fetch(url, {
          signal,
          headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        });
      } catch (cause) {
        // A browser CORS rejection lands here, indistinguishable from offline.
        throw new Error(
          `Could not reach the ENA Reports API at ${base} — network error or CORS policy (${String(cause)})`,
        );
      }

      if (response.status === 404) return []; // no records of this kind yet
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `ENA Reports API returned ${response.status} — check the Webin credentials`,
        );
      }
      if (!response.ok) {
        throw new Error(`ENA Reports API returned ${response.status} ${response.statusText}`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return [];
      return payload
        .map((entry) =>
          entry && typeof entry === "object" && "report" in entry
            ? (entry as { report: Row }).report
            : (entry as Row),
        )
        .filter((row): row is Row => row !== null && typeof row === "object");
    },
  };
}
