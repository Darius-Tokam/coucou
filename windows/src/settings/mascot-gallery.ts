// A lazy gallery for installed MascotForge exports and one user-picked folder.

import { Bridge, onEvent, type MascotChanged, type MascotGalleryItem, type MascotInfo, type MascotSlot } from "../core/bridge";
import type { Settings } from "../core/state";
import { t } from "../i18n/i18n";
import { MascotHost } from "../mascot/host";
import { h } from "../views/dom";
import { importErrorText } from "./mascot-errors";
import { activeRoles, selectThumbnailIds, type CurrentMascots } from "./mascot-gallery-logic";

export { activeRoles, selectThumbnailIds } from "./mascot-gallery-logic";

export function engineLabel(engine: MascotInfo["engine"]): string {
  switch (engine) {
    case "3d": return t("3D");
    case "blob": return t("Blob");
    case "video": return t("Video");
  }
}

function itemKey(item: MascotGalleryItem): string {
  return `${item.source}:${item.id}`;
}

export function mascotGallery(
  settings: () => Settings,
  save: () => void | Promise<void>,
  onItems?: (items: readonly MascotGalleryItem[]) => void,
): HTMLElement {
  const grid = h("div", { class: "mascot-gallery-grid" });
  const folder = h("div", { class: "hint path" });
  const notice = h("div", { class: "notice err" });
  notice.style.display = "none";
  const current: CurrentMascots = {};
  const previews = new Map<string, HTMLElement>();
  const mounted = new Map<string, MascotHost>();
  const visible = new Set<string>();
  const applyButtons = new Map<string, Partial<Record<MascotSlot, HTMLButtonElement>>>();
  let order: string[] = [];
  let observer: IntersectionObserver | null = null;
  let itemsByKey = new Map<string, MascotGalleryItem>();

  const showError = (text = "") => {
    notice.textContent = text;
    notice.style.display = text ? "block" : "none";
  };

  const refreshActive = () => {
    for (const [key, buttons] of applyButtons) {
      const item = itemsByKey.get(key);
      if (!item) continue;
      const active = new Set(activeRoles(item, current));
      for (const slot of ["claude", "codex"] as const) {
        const button = buttons[slot];
        if (!button) continue;
        button.classList.toggle("active", active.has(slot));
        button.setAttribute("aria-pressed", String(active.has(slot)));
        button.title = active.has(slot) ? t("Active") : "";
      }
    }
  };

  const syncPreviews = () => {
    const wanted = new Set(selectThumbnailIds(order.filter((key) => visible.has(key)), [...mounted.keys()]));
    for (const [key, host] of mounted) {
      if (wanted.has(key)) continue;
      host.dispose();
      mounted.delete(key);
    }
    for (const key of wanted) {
      if (mounted.has(key)) continue;
      const item = itemsByKey.get(key);
      const preview = previews.get(key);
      if (!item || !preview) continue;
      const host = new MascotHost(preview, { thumb: true });
      host.load(item.info);
      host.play("idle", true);
      host.setPaused(true);
      mounted.set(key, host);
    }
  };

  const disposePreviews = () => {
    observer?.disconnect();
    observer = null;
    for (const host of mounted.values()) host.dispose();
    mounted.clear();
    visible.clear();
    previews.clear();
    applyButtons.clear();
  };

  const render = (items: MascotGalleryItem[]) => {
    onItems?.(items);
    disposePreviews();
    itemsByKey = new Map(items.map((item) => [itemKey(item), item]));
    order = items.map(itemKey);
    grid.replaceChildren();
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.galleryKey;
          if (!key) continue;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        syncPreviews();
      });
    }

    for (const item of items) {
      const key = itemKey(item);
      const preview = h("div", { class: "mascot-gallery-preview" });
      preview.dataset.galleryKey = key;
      previews.set(key, preview);
      preview.addEventListener("mouseenter", () => mounted.get(key)?.setPaused(false));
      preview.addEventListener("mouseleave", () => mounted.get(key)?.setPaused(true));
      observer?.observe(preview);

      const error = h("div", { class: "hint mascot-gallery-error" });
      error.style.display = "none";
      const buttons: Partial<Record<MascotSlot, HTMLButtonElement>> = {};
      const apply = (slot: MascotSlot, label: string) => {
        const button = h("button", { text: label }) as HTMLButtonElement;
        buttons[slot] = button;
        button.addEventListener("click", async () => {
          button.disabled = true;
          error.style.display = "none";
          try {
            const result = await Bridge.mascotApply(item.source, item.id, slot);
            if (typeof result === "string") {
              error.textContent = importErrorText(result);
              error.style.display = "block";
            } else {
              current[slot] = result;
              refreshActive();
            }
          } catch {
            error.textContent = t("Coucou couldn't copy the folder.");
            error.style.display = "block";
          } finally {
            button.disabled = false;
          }
        });
        return button;
      };
      applyButtons.set(key, buttons);

      const actions = h(
        "div",
        { class: "mascot-gallery-actions" },
        apply("claude", t("Claude Code")),
        apply("codex", t("Codex")),
      );
      if (item.source === "library") {
        const remove = h("button", { class: "danger", text: t("Remove from gallery") }) as HTMLButtonElement;
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          error.style.display = "none";
          const failed = await Bridge.mascotForget(item.id);
          if (failed) {
            error.textContent = t("The mascot could not be removed from the gallery.");
            error.style.display = "block";
            remove.disabled = false;
          } else {
            await refresh();
          }
        });
        actions.append(remove);
      }

      grid.append(h(
        "article",
        { class: "mascot-gallery-item" },
        preview,
        h("div", { class: "mascot-gallery-name", text: item.info.name || item.id }),
        h("div", { class: "tag", text: engineLabel(item.info.engine) }),
        actions,
        error,
      ));
    }
    refreshActive();
  };

  const refresh = async () => {
    showError();
    const items = await Bridge.mascotGallery();
    if (items === null) {
      showError(t("The mascot gallery could not be loaded."));
      render([]);
      return;
    }
    render(items);
  };

  const choose = h("button", { text: t("Choose the mascot folder") }) as HTMLButtonElement;
  choose.addEventListener("click", async () => {
    choose.disabled = true;
    showError();
    try {
      const picked = await Bridge.pickFolder(settings().mascotFolder);
      if (!picked) return;
      settings().mascotFolder = picked;
      await save();
      folder.textContent = picked;
      await refresh();
    } catch {
      showError(t("Settings could not be saved."));
    } finally {
      choose.disabled = false;
    }
  });

  folder.textContent = settings().mascotFolder ?? t("No mascot folder chosen.");
  void Promise.all([
    Bridge.mascotCurrent("claude"),
    Bridge.mascotCurrent("codex"),
  ]).then(([claude, codex]) => {
    current.claude = claude;
    current.codex = codex;
    refreshActive();
  });
  void onEvent<MascotChanged>("mascot-changed", (changed) => {
    current[changed.slot] = changed.info;
    refreshActive();
    void refresh();
  });
  void refresh();

  return h(
    "div",
    { class: "mascot-gallery" },
    h("h3", { text: t("Gallery") }),
    h("div", { class: "row" }, choose, folder),
    grid,
    notice,
  );
}
