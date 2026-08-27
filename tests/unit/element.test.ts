import { afterEach, describe, expect, it, vi } from "vitest";
import { EnaBrowserElement } from "../../src/element.js";
import type { DataSource, Row } from "../../src/types.js";

customElements.define("ena-browser-test", class extends EnaBrowserElement {});

const rows: Row[] = [
  { accession: "ERS1", alias: "s1", title: "One", status: "PRIVATE" },
  { accession: "ERS2", alias: "s2", title: "Two", status: "CANCELLED" },
];

function mount(config: Partial<EnaBrowserElement["config"]> = {}): EnaBrowserElement {
  const element = document.createElement("ena-browser-test") as EnaBrowserElement;
  element.config = { entity: "samples", rows, ...config };
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<ena-browser>", () => {
  it("builds a toolbar and a grid on connect", () => {
    const element = mount();
    expect(element.querySelector(".ena-browser-toolbar")).not.toBeNull();
    expect(element.querySelector(".ena-browser-grid")).not.toBeNull();
    expect(element.getRows()).toHaveLength(2);
  });

  it("destroys the Handsontable instance on disconnect", () => {
    const element = mount();
    const grid = (element as unknown as { grid: { isDestroyed: boolean } }).grid;
    element.remove();
    expect(grid.isDestroyed).toBe(true);
    expect(element.children).toHaveLength(0);
  });

  it("survives repeated connect/disconnect without leaking instances", () => {
    const element = mount();
    for (let i = 0; i < 3; i += 1) {
      element.remove();
      document.body.appendChild(element);
    }
    expect(element.querySelectorAll(".ena-browser-grid")).toHaveLength(1);
  });

  it("reads attributes into the config", () => {
    const element = document.createElement("ena-browser-test") as EnaBrowserElement;
    element.setAttribute("entity", "runs");
    element.setAttribute("mode", "edit");
    element.setAttribute("selection-mode", "multi");
    element.setAttribute("height", "400");
    document.body.appendChild(element);
    expect(element.config).toMatchObject({
      entity: "runs",
      mode: "edit",
      selectionMode: "multi",
      height: 400,
    });
    expect(element.style.height).toBe("400px");
  });

  it("re-emits grid events as ena-browser:* CustomEvents", () => {
    const element = mount({ selectionMode: "multi" });
    const seen = vi.fn();
    document.addEventListener("ena-browser:selection-change", seen);
    element.setSelection(["ERS1"]);
    expect(seen).toHaveBeenCalled();
    const event = seen.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({ keys: ["ERS1"], lastKey: "ERS1" });
    document.removeEventListener("ena-browser:selection-change", seen);
  });

  it("fetches from a configured source and reports failures", async () => {
    const failing: DataSource = {
      fetch: () => Promise.reject(new Error("boom")),
    };
    const element = mount({ rows: [], source: failing });
    const seen = vi.fn();
    element.addEventListener("ena-browser:error", seen);
    await element.refresh();
    expect(seen).toHaveBeenCalled();
    expect((seen.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      message: "boom",
    });
  });

  it("loads rows from a source", async () => {
    const element = mount({
      rows: [],
      source: { fetch: () => Promise.resolve(rows) },
    });
    await element.refresh();
    expect(element.getRows()).toHaveLength(2);
  });
});
