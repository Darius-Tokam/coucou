import type { MascotGalleryItem, MascotInfo, MascotSlot } from "../core/bridge";

const THUMBNAIL_LIMIT = 12;

export function selectThumbnailIds(
  visible: readonly string[],
  mounted: readonly string[],
): string[] {
  const visibleSet = new Set(visible);
  const selected = mounted.filter((id) => visibleSet.has(id)).slice(0, THUMBNAIL_LIMIT);
  const selectedSet = new Set(selected);
  for (const id of visible) {
    if (selected.length >= THUMBNAIL_LIMIT) break;
    if (!selectedSet.has(id)) {
      selected.push(id);
      selectedSet.add(id);
    }
  }
  return selected;
}

export type CurrentMascots = Partial<Record<MascotSlot, Pick<MascotInfo, "sourceId"> | null>>;

export function activeRoles(item: Pick<MascotGalleryItem, "id">, current: CurrentMascots): MascotSlot[] {
  return (["claude", "codex"] as const).filter((slot) => current[slot]?.sourceId === item.id);
}
