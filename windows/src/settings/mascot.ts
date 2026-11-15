// Settings → Mascot: where Coucou lives (top of the screen or a corner), and
// which MascotForge export sits in the corner (src-tauri/src/mascot.rs).

import { Bridge, onEvent, type MascotChanged, type MascotInfo } from "../core/bridge";
import type { Settings } from "../core/state";
import { t } from "../i18n/i18n";
import { h } from "../views/dom";
import { importErrorText } from "./mascot-errors";

export function mascotSection(settings: () => Settings, save: () => void): HTMLElement {
  const anchor = h("select", {}) as HTMLSelectElement;
  anchor.append(
    h("option", { value: "corner", text: t("In a corner of the screen") }),
    h("option", { value: "top", text: t("At the top of the screen") }),
  );
  anchor.value = settings().islandAnchor === "top" ? "top" : "corner";
  anchor.addEventListener("change", () => {
    settings().islandAnchor = anchor.value === "top" ? "top" : "corner";
    save();
  });

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
    const folder = await Bridge.pickFolder(null);
    if (!folder) return;
    choose.disabled = true;
    back.disabled = true;
    choose.textContent = t("Importing…");
    showNote(null);
    try {
      const result = await Bridge.mascotImport(folder, "claude");
      if (typeof result === "string") showNote("err", importErrorText(result));
      else show(result);
    } finally {
      choose.disabled = false;
      back.disabled = false;
      choose.textContent = t("Choose a MascotForge folder");
    }
  });

  back.addEventListener("click", async () => {
    back.disabled = true;
    try {
      await Bridge.mascotClear("claude");
      show(null);
    } finally {
      back.disabled = false;
    }
  });

  void Bridge.mascotCurrent("claude").then(show);
  void onEvent<MascotChanged>("mascot-changed", ({ slot, info }) => {
    if (slot === "claude") show(info);
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Mascot") })),
    h("div", { class: "row" }, h("label", { text: t("Where Coucou lives") }), anchor),
    h("div", { class: "hint", text: t("In a corner, your mascot waits without a background. Hover it to open Coucou, click it to keep Coucou open, drag it to move it.") }),
    h("div", { class: "row" }, choose, back),
    current,
    credit,
    note,
  );
}
