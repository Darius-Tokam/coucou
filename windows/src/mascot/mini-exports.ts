import type { MascotGalleryItem, MascotInfo } from "../core/bridge";
import type { AgentMascot } from "./agents";

export type MiniMascotMode = "role" | "gallery";

export interface MiniMascotChoices {
  mode: MiniMascotMode;
  pins: Readonly<Record<string, string>>;
}

export interface RoleMascots {
  claude: MascotInfo | null;
  codex: MascotInfo | null;
}

export function galleryItemKey(item: Pick<MascotGalleryItem, "source" | "id">): string {
  return `${item.source}:${item.id}`;
}

export function miniMascotSettingKey(kind: "project" | "type", name: string): string {
  return `${kind}:${name}`;
}

export function miniMascotKey(mascot: AgentMascot): string {
  return mascot.subagent
    ? miniMascotSettingKey("type", mascot.type ?? "")
    : miniMascotSettingKey("project", mascot.project);
}

function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function roleMascot(mascot: AgentMascot, roles: RoleMascots): MascotInfo | null {
  return mascot.family === "codex" ? (roles.codex ?? roles.claude) : roles.claude;
}

function compareGallery(left: MascotGalleryItem, right: MascotGalleryItem): number {
  if (left.source !== right.source) return left.source === "library" ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function miniExportsFor(
  minis: readonly AgentMascot[],
  gallery: readonly MascotGalleryItem[],
  choices: MiniMascotChoices,
  roles: RoleMascots,
): readonly (MascotInfo | null)[] {
  if (choices.mode !== "gallery") return minis.map((mascot) => roleMascot(mascot, roles));

  const eligible = gallery
    .filter((item) => item.info.engine === "3d" || item.info.engine === "blob")
    .sort(compareGallery);
  if (eligible.length === 0) return minis.map((mascot) => roleMascot(mascot, roles));

  const byKey = new Map(eligible.map((item) => [galleryItemKey(item), item]));
  const randomPool = eligible.filter((item, index) =>
    eligible.findIndex((candidate) => candidate.id === item.id) === index
  );
  const usedIds = new Set<string>();

  return minis.map((mascot) => {
    const key = miniMascotKey(mascot);
    const pinned = byKey.get(choices.pins[key] ?? "");
    if (pinned) {
      usedIds.add(pinned.id);
      return pinned.info;
    }

    const start = hashName(key) % randomPool.length;
    let selected = randomPool[start];
    for (let offset = 0; offset < randomPool.length; offset += 1) {
      const candidate = randomPool[(start + offset) % randomPool.length];
      if (!usedIds.has(candidate.id)) {
        selected = candidate;
        break;
      }
    }
    usedIds.add(selected.id);
    return selected.info;
  });
}
