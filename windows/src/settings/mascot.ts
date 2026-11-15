// Settings mascot controls: island placement and one MascotForge export per agent family.

import { Bridge, onEvent, type MascotChanged, type MascotInfo, type MascotSlot } from "../core/bridge";
import type { Settings, SubagentLook } from "../core/state";
import { t } from "../i18n/i18n";
import { colorForType } from "../mascot/agents";
import { h } from "../views/dom";
import { importErrorText } from "./mascot-errors";

const ACCESSORIES = ["none", "beret", "glasses", "sunglasses"] as const;
const EYES = ["dot", "capsule"] as const;
const CHEEKS = ["true", "false"] as const;

function lookLabel(value: string): string {
  switch (value) {
    case "none": return t("None");
    case "beret": return t("Beret");
    case "glasses": return t("Glasses");
    case "sunglasses": return t("Sunglasses");
    case "dot": return t("Dot");
    case "capsule": return t("Capsule");
    case "true": return t("On");
    case "false": return t("Off");
    default: return value;
  }
}

function lookFieldLabel(field: "accessory" | "eyes" | "cheeks"): string {
  switch (field) {
    case "accessory": return t("Accessory");
    case "eyes": return t("Eyes");
    case "cheeks": return t("Cheeks");
  }
}

export function mascotSection(
  settings: () => Settings,
  save: () => void | Promise<void>,
): HTMLElement {
  const infos: Partial<Record<MascotSlot, MascotInfo | null>> = {};
  const blobControls = new Set<HTMLSelectElement>();
  const settingsNote = h("div", { class: "notice err" });
  settingsNote.style.display = "none";

  const showSettingsError = (on: boolean) => {
    settingsNote.textContent = on ? t("Settings could not be saved.") : "";
    settingsNote.style.display = on ? "block" : "none";
  };

  const persist = async (button?: HTMLButtonElement) => {
    if (button) button.disabled = true;
    showSettingsError(false);
    try {
      await save();
    } catch {
      showSettingsError(true);
    } finally {
      if (button) button.disabled = false;
    }
  };

  const blobLooksEnabled = () => {
    const claude = infos.claude;
    const codex = infos.codex;
    return claude?.engine === "blob" && (codex == null || codex.engine === "blob");
  };

  const refreshBlobControls = () => {
    const enabled = blobLooksEnabled();
    for (const control of blobControls) control.disabled = !enabled;
  };

  const anchor = h("select", {}) as HTMLSelectElement;
  anchor.append(
    h("option", { value: "corner", text: t("In a corner of the screen") }),
    h("option", { value: "top", text: t("At the top of the screen") }),
  );
  anchor.value = settings().islandAnchor === "top" ? "top" : "corner";
  anchor.addEventListener("change", () => {
    settings().islandAnchor = anchor.value === "top" ? "top" : "corner";
    void persist();
  });

  const slotBlock = (slot: MascotSlot, title: string): HTMLElement => {
    const current = h("div", { class: "hint" });
    const credit = h("div", { class: "hint" });
    const note = h("div", { class: "notice" });
    note.style.display = "none";
    const showNote = (kind: "err" | "warn" | null, text = "") => {
      note.className = kind ? `notice ${kind}` : "notice";
      note.textContent = text;
      note.style.display = kind ? "block" : "none";
    };

    const choose = h("button", { class: "primary", text: t("Choose a MascotForge folder") }) as HTMLButtonElement;
    const back = h("button", { text: t("Back to Mochi") }) as HTMLButtonElement;

    const show = (info: MascotInfo | null) => {
      infos[slot] = info;
      refreshBlobControls();
      current.textContent = t("Current mascot: {name}", { name: info?.name ?? "Mochi" });
      credit.textContent = info?.credit ? t("Engine: {credit}", { credit: info.credit }) : "";
      credit.style.display = info?.credit ? "block" : "none";
      back.style.display = info ? "" : "none";
      if (info?.engine === "video" && info.alpha === "none") {
        showNote("warn", t("This video has no transparency: it will show its background."));
      } else {
        showNote(null);
      }
    };

    choose.addEventListener("click", async () => {
      choose.disabled = true;
      back.disabled = true;
      showNote(null);
      try {
        const folder = await Bridge.pickFolder(null);
        if (!folder) return;
        choose.textContent = t("Importing…");
        const result = await Bridge.mascotImport(folder, slot);
        if (typeof result === "string") showNote("err", importErrorText(result));
        else show(result);
      } catch {
        showNote("err", t("Coucou couldn't copy the folder."));
      } finally {
        choose.disabled = false;
        back.disabled = false;
        choose.textContent = t("Choose a MascotForge folder");
      }
    });

    back.addEventListener("click", async () => {
      back.disabled = true;
      showNote(null);
      try {
        await Bridge.mascotClear(slot);
        show(null);
      } catch {
        showNote("err", t("Settings could not be saved."));
      } finally {
        back.disabled = false;
      }
    });

    void Bridge.mascotCurrent(slot).then(show);
    void onEvent<MascotChanged>("mascot-changed", (changed) => {
      if (changed.slot === slot) show(changed.info);
    });

    return h(
      "div",
      { class: "mascot-slot" },
      h("h3", { text: title }),
      h("div", { class: "row" }, choose, back),
      current,
      credit,
      note,
    );
  };

  const size = h("input", {
    type: "range",
    min: "60",
    max: "120",
    step: "10",
  }) as HTMLInputElement;
  size.value = String(settings().miniSize ?? 120);
  const sizeValue = h("span", { class: "hint", text: `${size.value} px` });
  size.addEventListener("input", () => {
    sizeValue.textContent = `${size.value} px`;
  });
  size.addEventListener("change", () => {
    settings().miniSize = Number(size.value);
    void persist();
  });

  const display = h("select") as HTMLSelectElement;
  display.append(
    h("option", { value: "all", text: t("Sessions and subagents") }),
    h("option", { value: "sessions", text: t("Sessions only") }),
    h("option", { value: "none", text: t("No small mascots") }),
  );
  display.value = settings().miniDisplay ?? "all";
  display.addEventListener("change", () => {
    settings().miniDisplay = display.value === "sessions"
      ? "sessions"
      : display.value === "none" ? "none" : "all";
    void persist();
  });

  const lookFor = (type: string): SubagentLook => {
    settings().subagentLooks ??= {};
    return settings().subagentLooks[type] ??= {
      color: null,
      accessory: null,
      eyes: null,
      cheeks: null,
    };
  };

  const lookSelect = (
    type: string,
    field: "accessory" | "eyes" | "cheeks",
    values: readonly string[],
  ): HTMLSelectElement => {
    const select = h("select", { "aria-label": lookFieldLabel(field) }) as HTMLSelectElement;
    select.append(h("option", { value: "", text: t("Default") }));
    for (const value of values) {
      select.append(h("option", { value, text: lookLabel(value) }));
    }
    select.value = lookFor(type)[field] ?? "";
    select.addEventListener("change", () => {
      lookFor(type)[field] = select.value || null;
      void persist();
    });
    blobControls.add(select);
    select.disabled = !blobLooksEnabled();
    return select;
  };

  const looks = h("div", { class: "mascot-looks" });
  const labeledLook = (label: string, control: HTMLElement) => h(
    "label",
    { style: "min-width:0;display:flex;flex-direction:column;gap:4px" },
    h("span", { class: "hint", text: label }),
    control,
  );
  const redrawLooks = () => {
    blobControls.clear();
    looks.replaceChildren();
    for (const type of settings().knownSubagentTypes ?? []) {
      const look = lookFor(type);
      const color = h("input", {
        type: "color",
        value: colorForType(type, settings().subagentLooks),
        "aria-label": `${t("Subagent colors")}: ${type}`,
      }) as HTMLInputElement;
      color.value = colorForType(type, settings().subagentLooks);
      color.addEventListener("change", () => {
        look.color = color.value;
        void persist();
      });
      looks.append(h(
        "div",
        { class: "row", style: "margin-top:8px" },
        h("label", { text: type }),
        labeledLook(t("Color"), color),
        labeledLook(t("Accessory"), lookSelect(type, "accessory", ACCESSORIES)),
        labeledLook(t("Eyes"), lookSelect(type, "eyes", EYES)),
        labeledLook(t("Cheeks"), lookSelect(type, "cheeks", CHEEKS)),
      ));
    }
    refreshBlobControls();
  };
  redrawLooks();

  const addType = h("input", {
    type: "text",
    placeholder: t("Add a type"),
  }) as HTMLInputElement;
  const add = h("button", { text: t("Add") }) as HTMLButtonElement;
  add.addEventListener("click", async () => {
    const type = addType.value.trim();
    if (!type || (settings().knownSubagentTypes ?? []).includes(type)) return;
    settings().knownSubagentTypes ??= [];
    settings().knownSubagentTypes.push(type);
    lookFor(type);
    redrawLooks();
    addType.value = "";
    await persist(add);
  });

  const reset = h("button", { text: t("Put the mascots back in line") }) as HTMLButtonElement;
  reset.addEventListener("click", async () => {
    settings().miniPositions = {};
    await persist(reset);
  });

  const claude = slotBlock("claude", t("Claude Code mascot"));
  const codex = slotBlock("codex", t("Codex mascot"));

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Mascot") })),
    h("div", { class: "row" }, h("label", { text: t("Where Coucou lives") }), anchor),
    h("div", { class: "hint", text: t("In a corner, your mascot waits without a background. Click it to open Coucou, drag it to move it. Each running agent gets its own small mascot.") }),
    claude,
    codex,
    h("div", { class: "hint", text: t("Without a Codex mascot, Codex agents use the Claude Code one.") }),
    h("div", { class: "row" }, h("label", { text: t("Size of the small mascots") }), size, sizeValue),
    h("div", { class: "row" }, h("label", { text: t("Small mascots") }), display),
    h("h3", { text: t("Subagent colors") }),
    looks,
    h("div", { class: "row" }, addType, add),
    h("div", { class: "row" }, reset),
    settingsNote,
  );
}
