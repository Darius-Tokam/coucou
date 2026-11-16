// Corner mode's mascot (see corner.ts): a box where Rust says the mascot sits,
// showing the active MascotForge export in an iframe, or Mochi when there is
// none. A transparent layer over it takes the mouse: hover, click, drag.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bridge, type CornerLayout, type MascotInfo } from "../core/bridge";
import type { BotStateName } from "../core/layout";
import { MascotHost } from "../mascot/host";
import { mascotStateFor, playsImmediately, shouldPause } from "../mascot/states";
import { DRAG_THRESHOLD } from "../mochi/desktop-logic";
import { mascotPointer } from "./corner";
import { MochiCanvas } from "./mochi-canvas";

/** What the island does when the mascot is hovered, left or clicked. */
export interface CornerHandlers {
  enter(): void;
  leave(): void;
  click(): void;
  /** A press: whatever a hover was about to open waits. */
  press(): void;
  /** Only a closed corner can be dragged: the window is then the mascot. */
  canDrag(): boolean;
}

export class CornerView {
  private readonly box: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly host: MascotHost;
  private info: MascotInfo | null = null;
  /** The export failed to load: Mochi stands in until another is chosen. */
  private failed = false;
  private enabled = false;
  private state: BotStateName = "idle";
  private layout: CornerLayout | null = null;
  /** The pointer is on the mascot: a calm mascot plays its hover animation. */
  private hovered = false;

  private readonly mochi: MochiCanvas;

  private press: { x: number; y: number } | null = null;

  constructor(root: HTMLElement, private readonly handlers: CornerHandlers) {
    this.box = document.createElement("div");
    this.box.className = "mascot-box";
    this.mochi = new MochiCanvas(this.box);
    this.layer = document.createElement("div");
    this.layer.className = "mascot-layer";
    this.box.append(this.layer);
    root.append(this.box);
    // The iframe it adds stays under the mouse layer (z-index in style.css).
    this.host = new MascotHost(this.box);
    this.host.onError = (message) => {
      void Bridge.log(`mascot failed to load, Mochi stands in: ${message}`);
      this.failed = true;
      this.host.load(null);
      this.refresh();
      this.play();
    };
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
    this.layout = layout;
    const m = layout.mascot;
    Object.assign(this.box.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` });
  }

  /** The MascotForge export to show, or null for Mochi. */
  load(info: MascotInfo | null) {
    this.info = info;
    this.failed = false;
    this.host.load(info);
    this.refresh();
    this.play();
  }

  /**
   * The cursor in window-logical coordinates, wherever it is on screen (Rust's
   * poll): the mascot looks at it, and reacts while it is on him.
   */
  pointer(x: number, y: number) {
    if (!this.layout) return;
    const p = mascotPointer(this.layout, x, y);
    if (this.mascotShown) this.host.pointer(p.x, p.y);
    this.setHovered(p.inside);
  }

  private setHovered(on: boolean) {
    if (on === this.hovered) return;
    this.hovered = on;
    // A hover is answered at once, even by a video between two loops.
    this.play(true);
  }

  private get mascotShown(): boolean {
    return this.info != null && !this.failed;
  }

  setState(state: BotStateName) {
    if (state === this.state) return;
    this.state = state;
    this.play();
  }

  private play(now = false) {
    if (this.info && !this.failed) {
      const name = mascotStateFor(this.state, this.hovered, this.info.states, this.info.defaultState);
      this.host.play(name, now || playsImmediately(this.state));
      this.host.setPaused(shouldPause(this.state, this.hovered));
    } else {
      this.mochi.setState(this.state);
    }
  }

  /** Mochi draws only when he is the one shown. */
  private refresh() {
    const mochiShown = this.enabled && (!this.info || this.failed);
    this.mochi.setShown(mochiShown);
  }

  private wireInput() {
    this.layer.addEventListener("pointerenter", () => {
      this.setHovered(true);
      this.handlers.enter();
    });
    this.layer.addEventListener("pointerleave", () => {
      this.setHovered(false);
      this.handlers.leave();
    });
    this.layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.press = { x: e.clientX, y: e.clientY };
      this.handlers.press();
    });
    this.layer.addEventListener("pointermove", (e) => {
      if (!this.press || (e.buttons & 1) === 0) return;
      const moved = Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y);
      if (moved < DRAG_THRESHOLD || !this.handlers.canDrag()) return;
      this.press = null;
      void Bridge.cornerDragStarted().then(() => getCurrentWindow().startDragging());
    });
    this.layer.addEventListener("pointerup", (e) => {
      if (this.press && e.button === 0) {
        // The mascot reacts to every click, a double click included.
        if (this.mascotShown) this.host.poke();
        this.handlers.click();
      }
      this.press = null;
    });
  }
}
