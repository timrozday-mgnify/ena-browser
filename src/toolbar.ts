/**
 * The strip above the grid. Everything on it is optional and driven by the
 * config; it owns no state of its own — it reads and drives the grid.
 */

import type { EnaGrid } from "./grid.js";
import type { EnaBrowserConfig } from "./types.js";

const QUICK_FILTER_DEBOUNCE_MS = 150;

export class EnaToolbar {
  readonly element: HTMLDivElement;

  private countLabel: HTMLSpanElement;
  private selectionLabel: HTMLSpanElement | null = null;
  private clearSelectionButton: HTMLButtonElement | null = null;
  private modePill: HTMLSpanElement;
  private pendingLabel: HTMLSpanElement | null = null;
  private discardButton: HTMLButtonElement | null = null;
  private columnsMenu: HTMLDivElement | null = null;
  private quickFilterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly grid: EnaGrid,
    private config: EnaBrowserConfig,
  ) {
    this.element = document.createElement("div");
    this.element.className = "ena-browser-toolbar";

    this.appendStatusToggles();
    this.appendQuickFilter();
    this.appendColumnsButton();

    this.element.appendChild(spacer());

    this.countLabel = span("ena-browser-count");
    this.element.appendChild(this.countLabel);
    this.appendSelection();
    this.modePill = span("ena-browser-pill");
    this.element.appendChild(this.modePill);
    this.appendEditControls();

    this.grid.addEventListener("filter-change", () => this.refresh());
    this.grid.addEventListener("selection-change", () => this.refresh());
    this.grid.addEventListener("change", () => this.refresh());
    this.refresh();
  }

  destroy(): void {
    if (this.quickFilterTimer) clearTimeout(this.quickFilterTimer);
    this.closeColumnsMenu();
    this.element.remove();
  }

  /** Re-read the config after the host changed mode or selection mode. */
  setConfig(config: EnaBrowserConfig): void {
    this.config = config;
    this.refresh();
  }

  // ------------------------------------------------------------------ pieces

  private appendStatusToggles(): void {
    const status = this.config.statusFilter ?? {};
    const toggle = (label: string, key: "excludeCancelled" | "excludeSuppressed"): void => {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = status[key] !== false;
      input.dataset["role"] = key;
      input.addEventListener("change", () => {
        this.config.statusFilter = {
          ...this.config.statusFilter,
          [key]: input.checked,
        };
        this.grid.setStatusFilter(this.config.statusFilter);
      });
      this.element.appendChild(labelled(label, input));
    };
    toggle("Hide cancelled", "excludeCancelled");
    toggle("Hide suppressed", "excludeSuppressed");
  }

  private appendQuickFilter(): void {
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Filter…";
    input.dataset["role"] = "quick-filter";
    input.addEventListener("input", () => {
      if (this.quickFilterTimer) clearTimeout(this.quickFilterTimer);
      this.quickFilterTimer = setTimeout(
        () => this.grid.setQuickFilter(input.value),
        QUICK_FILTER_DEBOUNCE_MS,
      );
    });
    this.element.appendChild(input);
  }

  private appendColumnsButton(): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Columns";
    button.dataset["role"] = "columns";
    button.addEventListener("click", () => {
      if (this.columnsMenu) this.closeColumnsMenu();
      else this.openColumnsMenu(button);
    });
    this.element.appendChild(button);
  }

  private appendSelection(): void {
    if (!this.config.selectionMode || this.config.selectionMode === "none") {
      return;
    }
    this.selectionLabel = span("ena-browser-selection-count");
    this.element.appendChild(this.selectionLabel);
    this.clearSelectionButton = document.createElement("button");
    this.clearSelectionButton.type = "button";
    this.clearSelectionButton.textContent = "Clear selection";
    this.clearSelectionButton.dataset["role"] = "clear-selection";
    this.clearSelectionButton.addEventListener("click", () => this.grid.clearSelection());
    this.element.appendChild(this.clearSelectionButton);
  }

  private appendEditControls(): void {
    this.pendingLabel = span("ena-browser-count");
    this.pendingLabel.dataset["role"] = "pending";
    this.element.appendChild(this.pendingLabel);

    this.discardButton = document.createElement("button");
    this.discardButton.type = "button";
    this.discardButton.textContent = "Discard changes";
    this.discardButton.dataset["role"] = "discard";
    this.discardButton.addEventListener("click", () => this.grid.discardChanges());
    this.element.appendChild(this.discardButton);
  }

  // ------------------------------------------------------------- columns menu

  /** Same code path as the grid's context-menu pin/hide items. */
  private openColumnsMenu(anchor: HTMLElement): void {
    const menu = document.createElement("div");
    menu.className = "ena-browser-columns-menu";
    menu.dataset["role"] = "columns-menu";
    // The menu lives on <body>, so it carries the theme rather than inheriting it.
    const owner = this.element.closest<HTMLElement>(".ena-browser");
    menu.dataset["theme"] = owner?.dataset["theme"] ?? "light";
    menu.toggleAttribute(
      "data-theme-detached",
      owner?.hasAttribute("data-theme-detached") ?? false,
    );

    for (const column of this.grid.listColumns()) {
      const row = document.createElement("div");
      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = !this.grid.isHidden(column.name);
      visible.addEventListener("change", () => {
        if (visible.checked) this.grid.showColumn(column.name);
        else this.grid.hideColumn(column.name);
      });
      row.appendChild(visible);

      const name = document.createElement("span");
      name.textContent = column.title ?? column.name;
      row.appendChild(name);

      const pin = document.createElement("button");
      pin.type = "button";
      const pinned = this.grid.isPinned(column.name);
      pin.textContent = pinned ? "Unpin" : "Pin";
      pin.addEventListener("click", () => {
        if (pinned) this.grid.unpin(column.name);
        else this.grid.pin(column.name);
        this.closeColumnsMenu();
        this.openColumnsMenu(anchor);
      });
      row.appendChild(pin);
      menu.appendChild(row);
    }

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left + window.scrollX}px`;
    menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
    document.body.appendChild(menu);
    this.columnsMenu = menu;
  }

  private closeColumnsMenu(): void {
    this.columnsMenu?.remove();
    this.columnsMenu = null;
  }

  // ----------------------------------------------------------------- refresh

  refresh(): void {
    const total = this.grid.getRows().length;
    const visible = this.grid.getVisibleRows().length;
    this.countLabel.textContent = `${visible} of ${total}`;

    if (this.selectionLabel) {
      const count = this.grid.getSelection().length;
      this.selectionLabel.textContent = `${count} selected`;
      if (this.clearSelectionButton) {
        this.clearSelectionButton.disabled = count === 0;
      }
    }

    const editing = this.grid.getMode() === "edit";
    this.modePill.textContent = editing ? "Editing" : "Read-only";
    this.modePill.dataset["mode"] = editing ? "edit" : "read";

    const pending = this.grid.pendingCount;
    if (this.pendingLabel) {
      this.pendingLabel.hidden = !editing;
      this.pendingLabel.textContent = `${pending} pending change${pending === 1 ? "" : "s"}`;
    }
    if (this.discardButton) {
      this.discardButton.hidden = !editing;
      this.discardButton.disabled = pending === 0;
    }
  }
}

function span(className: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

function spacer(): HTMLSpanElement {
  return span("ena-browser-spacer");
}

function labelled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.appendChild(input);
  label.appendChild(document.createTextNode(text));
  return label;
}
