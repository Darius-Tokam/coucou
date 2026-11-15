// Corner mode (Settings → Where Coucou lives → In a corner of the screen): the
// mascot sits in a corner, and the island opens as a card beside it. Rust
// places the window and says where the mascot and the panel area are
// (`corner-layout`, island.rs); this decides what takes the mouse and where
// the card sits in that area.

import type { CornerLayout, Rect } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import type { AgentMascot } from "../mascot/agents";

/** Corner mode exists on Windows only: gtk-layer-shell keeps the Linux island at the top. */
export const CORNER_SUPPORTED =
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent ?? "");

/** What a click on the corner mascot does. */
export type MascotClick = "open" | "pin" | "close" | "panel" | "none";

/** Two clicks closer than this are a double click (Windows' default is 500 ms). */
export const DOUBLE_CLICK_MS = 500;

/**
 * Folded: open the card. Opened by Coucou itself (an approval, a notice): keep
 * it open. Pinned: close it, except while an approval waits (folding it would
 * hide Allow / Deny) and for the second click of a double click, which would
 * undo the first.
 */
export function mascotClickAction(s: {
  open: boolean;
  pinned: boolean;
  approvalWaits: boolean;
  subagentCard?: boolean;
  /** Since the click that opened the card; unknown counts as long ago. */
  sinceOpenMs?: number;
}): MascotClick {
  if (s.subagentCard && !s.approvalWaits) return "panel";
  if (!s.open) return "open";
  if (!s.pinned) return "pin";
  if (s.approvalWaits || (s.sinceOpenMs ?? Infinity) < DOUBLE_CLICK_MS) return "none";
  return "close";
}

export function subagentClickAction(
  openKey: string | null,
  clickedKey: string,
  smallPanel: boolean,
): "open" | "close" {
  return smallPanel && openKey === clickedKey ? "close" : "open";
}

export function miniClickAction(s: {
  approvalWaits: boolean;
  defaultView: IslandViewName;
}): { changeFocus: boolean; view: IslandViewName } {
  return s.approvalWaits
    ? { changeFocus: false, view: s.defaultView }
    : { changeFocus: true, view: "overview" };
}

export function miniClickTarget(
  mascot: AgentMascot,
  approvalWaits: boolean,
): "approval" | "subagent" | "session" {
  if (approvalWaits) return "approval";
  return mascot.subagent ? "subagent" : "session";
}

/** The cursor (window-logical) in the mascot's own coordinates, and whether it is on it. */
export function mascotPointer(layout: CornerLayout, x: number, y: number): { x: number; y: number; inside: boolean } {
  const m = layout.mascot;
  const lx = x - m.x;
  const ly = y - m.y;
  return { x: lx, y: ly, inside: lx >= 0 && ly >= 0 && lx <= m.w && ly <= m.h };
}

/** Side of the corner mascot's box, logical px (island.rs MASCOT_SIZE). */
export const MASCOT_SIZE = 240;
const MIN_MASCOT_SIZE = 120;

export function clampMascotSize(size: number): number {
  if (!Number.isFinite(size)) return MASCOT_SIZE;
  return Math.min(MASCOT_SIZE, Math.max(MIN_MASCOT_SIZE, size));
}

/** Seconds before the open card folds once the pointer has left it and the mascot. */
export const CORNER_HOVER_CLOSE_S = 0.3;

/**
 * Folded, the corner window only hears Rust's `closed-hover`, four times a
 * second while the pointer is on the mascot. Each one re-arming the open-on-
 * hover timer would keep it from ever firing: only the first of a run counts.
 */
export class HoverStart {
  /** Longer than the poll's 250 ms gap: past it, the pointer had left. */
  private static readonly GAP_MS = 600;
  private last = -Infinity;

  /** The pointer is on the mascot at `now` (ms); true when a new hover starts. */
  enter(now: number): boolean {
    const starts = now - this.last > HoverStart.GAP_MS;
    this.last = now;
    return starts;
  }

  /** The pointer left (the page saw it go). */
  leave() {
    this.last = -Infinity;
  }
}

/** What takes the mouse: the mascot, and the island card while it is open. */
export function cornerRects(layout: CornerLayout, card: Rect | null): Rect[] {
  return card ? [card, layout.mascot, ...layout.minis] : [layout.mascot, ...layout.minis];
}

/** A mini's physical screen rectangle, for Rust to anchor the subagent card. */
export function miniScreenRect(layout: CornerLayout, index: number): Rect | null {
  const mini = layout.minis[index];
  if (!mini) return null;
  return {
    x: layout.window.x + mini.x * layout.scale,
    y: layout.window.y + mini.y * layout.scale,
    w: mini.w * layout.scale,
    h: mini.h * layout.scale,
  };
}

export interface SubagentPanelPlacement {
  rect: Rect;
  pointerSide: "top" | "bottom";
  pointerX: number;
}

/** Places the content-sized card inside Rust's anchored maximum panel area. */
export function subagentPanelPlacement(
  layout: CornerLayout,
  anchor: Rect,
  height: number,
): SubagentPanelPlacement | null {
  const panel = layout.panel;
  if (!panel) return null;
  const h = Math.min(panel.h, Math.max(0, height));
  const panelBottom = layout.window.y + (panel.y + panel.h) * layout.scale;
  const pointerSide = panelBottom <= anchor.y + 0.5 ? "bottom" : "top";
  const rect = {
    x: panel.x,
    y: pointerSide === "bottom" ? panel.y + panel.h - h : panel.y,
    w: panel.w,
    h,
  };
  const anchorCenter = (anchor.x + anchor.w / 2.0 - layout.window.x) / layout.scale;
  const pointerX = Math.min(rect.w - 18, Math.max(18, anchorCenter - rect.x));
  return { rect, pointerSide, pointerX };
}

/**
 * The island card of size w × h inside the panel area, against the mascot's
 * side: right-aligned when the mascot is on its right, bottom-aligned when the
 * mascot is lower down. Null when the window has no panel area (closed).
 */
export function placeInPanel(layout: CornerLayout, w: number, h: number): Rect | null {
  const panel = layout.panel;
  if (!panel) return null;
  const mascot = layout.mascot;
  const mascotRight = mascot.x + mascot.w / 2 > panel.x + panel.w / 2;
  const mascotLower = mascot.y + mascot.h / 2 > panel.y + panel.h / 2;
  return {
    x: mascotRight ? panel.x + panel.w - w : panel.x,
    y: mascotLower ? panel.y + panel.h - h : panel.y,
    w,
    h,
  };
}
