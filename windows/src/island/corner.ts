// Corner mode (Settings → Where Coucou lives → In a corner of the screen): the
// mascot sits in a corner, and the island opens as a card beside it. Rust
// places the window and says where the mascot and the panel area are
// (`corner-layout`, island.rs); this decides what takes the mouse and where
// the card sits in that area.

import type { CornerLayout, Rect } from "../core/bridge";

/** Corner mode exists on Windows only: gtk-layer-shell keeps the Linux island at the top. */
export const CORNER_SUPPORTED =
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent ?? "");

/** What a click on the corner mascot does. */
export type MascotClick = "open" | "pin" | "close" | "none";

/**
 * Folded: open the card. Open by hover: keep it open. Pinned: close it,
 * except while an approval waits: folding it would hide Allow / Deny.
 */
export function mascotClickAction(s: { open: boolean; pinned: boolean; approvalWaits: boolean }): MascotClick {
  if (!s.open) return "open";
  if (!s.pinned) return "pin";
  return s.approvalWaits ? "none" : "close";
}

/** Side of the corner mascot, logical px (island.rs MASCOT_SIZE). */
export const MASCOT_SIZE = 200;

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
  return card ? [layout.mascot, card] : [layout.mascot];
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
