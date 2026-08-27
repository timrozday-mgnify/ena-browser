import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, mergeColumns, normalizeStatus, rowKey } from "../../src/entities.js";

describe("rowKey", () => {
  it("prefers accession", () => {
    expect(
      rowKey("samples", {
        accession: "ERS1",
        secondary_accession: "SAMEA1",
        alias: "a",
      }),
    ).toBe("ERS1");
  });

  it("falls back to secondary_accession, then alias", () => {
    expect(rowKey("studies", { accession: "", secondary_accession: "SRP1" })).toBe("SRP1");
    expect(rowKey("studies", { alias: "study-1" })).toBe("study-1");
  });

  it("returns an empty string when the row identifies nothing", () => {
    expect(rowKey("files", { filename: "r1.fastq.gz" })).toBe("");
  });
});

describe("normalizeStatus", () => {
  it("upper-cases and defaults to empty", () => {
    expect(normalizeStatus({ status: "private" })).toBe("PRIVATE");
    expect(normalizeStatus({})).toBe("");
  });
});

describe("mergeColumns", () => {
  it("starts from the entity defaults", () => {
    const names = mergeColumns("runs", [], [], []).map((c) => c.name);
    expect(names).toEqual(DEFAULT_COLUMNS.runs);
  });

  it("keeps unknown keys present in the data", () => {
    const names = mergeColumns("samples", [{ accession: "ERS1", tax_id: 9606 }], [], []).map(
      (c) => c.name,
    );
    expect(names).toContain("tax_id");
  });

  it("derives every column from the data for files", () => {
    const names = mergeColumns(
      "files",
      [{ run_accession: "ERR1", filename: "a.fastq.gz" }],
      [],
      [],
    ).map((c) => c.name);
    expect(names).toEqual(["run_accession", "filename"]);
  });

  it("puts custom columns last and marks them read-only", () => {
    const columns = mergeColumns(
      "samples",
      [{ accession: "ERS1", tax_id: 9606 }],
      [],
      [{ name: "reads_assigned", title: "Reads", type: "numeric" }],
    );
    expect(columns.at(-1)).toMatchObject({
      name: "reads_assigned",
      title: "Reads",
      type: "numeric",
      readOnly: true,
    });
  });

  it("collapses duplicate names, config overriding defaults", () => {
    const columns = mergeColumns(
      "samples",
      [{ accession: "ERS1" }],
      [{ name: "accession", title: "ENA accession", width: 200 }],
      [],
    );
    expect(columns.filter((c) => c.name === "accession")).toHaveLength(1);
    expect(columns[0]).toMatchObject({ title: "ENA accession", width: 200 });
  });

  it("titles columns from their name by default", () => {
    const columns = mergeColumns("runs", [], [], []);
    expect(columns.find((c) => c.name === "study_accession")?.title).toBe("Study accession");
  });
});
