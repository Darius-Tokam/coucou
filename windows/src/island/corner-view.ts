// Corner mode's mascot (see corner.ts): a box where Rust says the mascot sits,
// showing the active MascotForge export in an iframe, or Mochi when there is
// none. A transparent layer over it takes the mouse: hover, click, drag.

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CornerLayout, MascotInfo } from "../core/bridge";
import type { BotStateName } from "../core/layout";
import { MascotHost } from "../mascot/host";
import { playsImmediately, resolveMascotState } from "../mascot/states";
import { BotEngine } from "../mochi/engine";
import { DRAG_THRESHOLD } from "../mochi/desktop-logic";

/** What the island does when the mascot is hovered, left or clicked. */
export interface CornerHandlers {
  enter(): void;
  leave(): void;
  click(): void;
  /** Only a closed corner can be dragged: the window is then the mascot. */
  canDrag(): boolean;
}

/** Mochi's frame pace in the corner, like on the desktop (desktop/main.ts). */
const MOCHI_FRAME_MS = 1000 / 30;

export class CornerView {
  private readonly box: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly host: MascotHost;
  private info: MascotInfo | null = null;
  private enabled = false;
  private state: BotStateName = "idle";

  private readonly mochiCanvas: HTMLCanvasElement;
  private readonly mochi = new BotEngine();
  private mochiTimer: number | null = null;
  private lastDraw = 0;

  private press: { x: number; y: number } | null = null;

  constructor(root: HTMLElement, private readonly handlers: CornerHandlers) {
    this.box = document.createElement("div");
    this.box.className = "mascot-box";
    this.mochiCanvas = document.createElement("canvas");
    this.mochiCanvas.className = "mascot-mochi";
    this.layer = document.createElement("div");
    this.layer.className = "mascot-layer";
    this.box.append(this.mochiCanvas, this.layer);
    root.append(this.box);
    // The iframe it adds stays under the mouse layer (z-index in style.css).
    this.host = new MascotHost(this.box);
    this.wireInput();
  }

  /** True while a MascotForge mascot (not Mochi) is shown. */
  get mascotActive(): boolean {
    return this.host.active;
  }

  /** Corner mode on or off: the box only exists on screen in corner mode. */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.box.style.display = on ? "block" : "none";
    this.refresh();
  }

  setLayout(layout: CornerLayout) {
    const m = layout.mascot;
    Object.assign(this.box.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` });
  }

  /** The MascotForge export to show, or null for Mochi. */
  load(info: MascotInfo | null) {
    this.info = info;
    this.host.load(info);
    this.refresh();
    this.play();
  }

  setState(state: BotStateName) {
    if (state === this.state) return;
    this.state = state;
    this.play();
  }

  private play() {
    if (this.info) {
      this.host.play(resolveMascotState(this.state, this.info.states, this.info.defaultState), playsImmediately(this.state));
    } else {
      this.mochi.setState(this.state);
    }
  }

  /** Mochi draws only when he is the one shown. */
  private refresh() {
    const mochiShown = this.enabled && !this.info;
    this.mochiCanvas.style.display = mochiShown ? "block" : "none";
    if (mochiShown) this.scheduleMochi();
    else if (this.mochiTimer != null) {
      window.clearTimeout(this.mochiTimer);
      this.mochiTimer = null;
    }
  }

  private scheduleMochi() {
    if (this.mochiTimer != null) return;
    const due = Math.max(0, this.lastDraw + MOCHI_FRAME_MS - performance.now());
    this.mochiTimer = window.setTimeout(() => {
      requestAnimationFrame((now) => {
        this.mochiTimer = null;
        if (!this.enabled || this.info) return;
        this.drawMochi(now);
        this.scheduleMochi();
      });
    }, due);
  }

  private drawMochi(now: number) {
    const ctx = this.mochiCanvas.getContext("2d");
    if (!ctx) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    const size = this.box.clientWidth || 200;
    const drawW = size * 0.8;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.mochiCanvas.width !== Math.round(size * dpr)) {
      this.mochiCanvas.width = Math.round(size * dpr);
      this.mochiCanvas.height = Math.round(size * dpr);
    }
    this.mochi.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, ((size - drawW) / 2) * dpr, 0);
    ctx.clearRect(-(size - drawW) / 2, 0, size, size);
    this.mochi.draw(ctx, drawW, size);
  }

  private wireInput() {
    this.layer.addEventListener("pointerenter", () => this.handlers.enter());
    this.layer.addEventListener("pointerleave", () => this.handlers.leave());
    this.layer.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.press = { x: e.clientX, y: e.clientY };
    });
    this.layer.addEventListener("pointermove", (e) => {
      if (!this.press || (e.buttons & 1) === 0) return;
      const moved = Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y);
      if (moved < DRAG_THRESHOLD || !this.handlers.canDrag()) return;
      this.press = null;
      void getCurrentWindow().startDragging();
    });
    this.layer.addEventListener("pointerup", (e) => {
      if (this.press && e.button === 0) this.handlers.click();
      this.press = null;
    });
  }
}
