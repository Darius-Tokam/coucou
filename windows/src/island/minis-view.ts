import { Bridge, type CornerLayout, type MascotInfo, type Rect } from "../core/bridge";
import { State } from "../core/state";
import {
  colorForType, exportFor, visibleSlots, type AgentMascot,
} from "../mascot/agents";
import { MascotHost } from "../mascot/host";
import { mascotStateFor, playsImmediately, shouldPause } from "../mascot/states";
import { DRAG_THRESHOLD } from "../mochi/desktop-logic";
import { DOUBLE_CLICK_MS } from "./corner";
import { MochiCanvas } from "./mochi-canvas";

export interface MiniHandlers {
  open(mascot: AgentMascot): void;
  more(): void;
  dragStart(): void;
  dragEnd(mascot: AgentMascot, at: { x: number; y: number }): Promise<void>;
  dragCancel(): void;
  reset(mascot: AgentMascot): Promise<void>;
}

class MiniMascotView {
  readonly box: HTMLDivElement;
  private readonly visual: HTMLDivElement;
  private readonly layer: HTMLButtonElement;
  private readonly dot: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private readonly host: MascotHost;
  private readonly mochi: MochiCanvas;
  private info: MascotInfo | null | undefined;
  private mascot: AgentMascot;
  private rect: Rect | null = null;
  private hovered = false;
  private failed = false;
  private playedState = "";
  private playedMascotState = "";
  private label: string | null = null;
  private color: string | null = null;
  private layout: CornerLayout | null = null;
  private press: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;
  private pointerScreen: { x: number; y: number } | null = null;
  private dragging = false;
  private dragAt = { x: 0, y: 0 };
  private clickTimer: number | null = null;

  constructor(root: HTMLElement, mascot: AgentMascot, handlers: MiniHandlers) {
    this.mascot = mascot;
    this.box = document.createElement("div");
    this.box.className = "mini-box";
    this.visual = document.createElement("div");
    this.visual.className = "mini-visual";
    this.mochi = new MochiCanvas(this.visual);
    this.host = new MascotHost(this.visual, { mini: true });
    this.host.onError = (message) => {
      void Bridge.log(`mini mascot failed to load, Mochi stands in: ${message}`);
      this.failed = true;
      this.playedMascotState = "";
      this.host.load(null);
      this.refresh();
      this.play();
    };

    const label = document.createElement("div");
    label.className = "mini-label";
    this.dot = document.createElement("span");
    this.dot.className = "mini-dot";
    this.text = document.createElement("span");
    this.text.className = "mini-label-text";
    label.append(this.dot, this.text);

    this.layer = document.createElement("button");
    this.layer.type = "button";
    this.layer.className = "mini-layer";
    this.layer.addEventListener("pointerenter", () => this.setHovered(true));
    this.layer.addEventListener("pointerleave", () => this.setHovered(false));
    this.layer.addEventListener("click", () => {
      if (this.dragging) return;
      if (this.clickTimer != null) window.clearTimeout(this.clickTimer);
      this.clickTimer = window.setTimeout(() => {
        this.clickTimer = null;
        if (this.host.active) this.host.poke();
        handlers.open(this.mascot);
      }, DOUBLE_CLICK_MS);
    });
    this.layer.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (this.clickTimer != null) window.clearTimeout(this.clickTimer);
      this.clickTimer = null;
      void handlers.reset(this.mascot);
    });
    this.layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !this.rect) return;
      this.press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offsetX: event.clientX - this.rect.x,
        offsetY: event.clientY - this.rect.y,
      };
      this.layer.setPointerCapture(event.pointerId);
    });
    this.layer.addEventListener("pointermove", (event) => {
      const press = this.press;
      if (!press || press.pointerId !== event.pointerId || !this.layout) return;
      this.rememberPointer(event.clientX, event.clientY);
      if (!this.dragging) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_THRESHOLD) return;
        this.dragging = true;
        this.box.classList.add("dragging");
        handlers.dragStart();
      }
      this.placeDragged();
    });
    this.layer.addEventListener("pointerup", (event) => {
      if (!this.press || this.press.pointerId !== event.pointerId) return;
      this.layer.releasePointerCapture(event.pointerId);
      if (!this.dragging || !this.layout) {
        this.press = null;
        return;
      }
      this.rememberPointer(event.clientX, event.clientY);
      this.placeDragged();
      const at = {
        x: this.layout.window.x + this.dragAt.x * this.layout.scale,
        y: this.layout.window.y + this.dragAt.y * this.layout.scale,
      };
      this.press = null;
      void handlers.dragEnd(this.mascot, at).finally(() => {
        this.dragging = false;
        this.pointerScreen = null;
        this.box.classList.remove("dragging");
      });
    });
    this.layer.addEventListener("pointercancel", (event) => {
      if (!this.press || this.press.pointerId !== event.pointerId) return;
      this.press = null;
      if (!this.dragging) return;
      this.dragging = false;
      this.pointerScreen = null;
      this.box.classList.remove("dragging");
      handlers.dragCancel();
    });

    this.box.append(this.visual, label, this.layer);
    root.append(this.box);
  }

  update(mascot: AgentMascot, info: MascotInfo | null, layout: CornerLayout, rect: Rect | null, color: string): void {
    this.mascot = mascot;
    this.layout = layout;
    if (mascot.label !== this.label) {
      this.label = mascot.label;
      this.text.textContent = mascot.label;
      this.layer.setAttribute("aria-label", mascot.label);
    }
    if (color !== this.color) {
      this.color = color;
      this.dot.style.background = color;
    }
    this.rect = rect;
    this.box.style.display = rect ? "block" : "none";
    if (this.dragging) {
      this.placeDragged();
    } else if (rect) {
      Object.assign(this.box.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
      });
    }
    if (this.info !== info) {
      this.info = info;
      this.failed = false;
      this.playedState = "";
      this.playedMascotState = "";
      this.host.load(info);
      this.refresh();
    }
    const look = mascot.subagent ? State.settings.subagentLooks[mascot.type ?? ""] : null;
    this.host.setLook(mascot.subagent ? {
      color,
      material: info?.tintMaterial ?? null,
      accessory: look?.accessory ?? null,
      eyes: look?.eyes ?? null,
      cheeks: look?.cheeks ?? null,
    } : null);
    this.play();
  }

  pointer(x: number, y: number): void {
    if (!this.rect) return;
    const lx = x - this.rect.x;
    const ly = y - this.rect.y;
    const inside = lx >= 0 && ly >= 0 && lx <= this.rect.w && ly <= this.rect.h;
    if (this.host.active) this.host.pointer(lx, ly);
    this.setHovered(inside);
  }

  remove(): void {
    if (this.clickTimer != null) window.clearTimeout(this.clickTimer);
    this.host.dispose();
    this.mochi.setShown(false);
    this.box.remove();
  }

  private setHovered(on: boolean): void {
    if (this.hovered === on) return;
    this.hovered = on;
    this.play(true);
  }

  private play(immediate = false): void {
    if (this.info && !this.failed) {
      const state = mascotStateFor(
        this.mascot.state,
        this.hovered,
        this.info.states,
        this.info.defaultState,
      );
      const changed = state !== this.playedState || this.mascot.state !== this.playedMascotState;
      if (!changed && !immediate) return;
      this.playedState = state;
      this.playedMascotState = this.mascot.state;
      this.host.play(state, immediate || (changed && playsImmediately(this.mascot.state)));
      this.host.setPaused(shouldPause(this.mascot.state, this.hovered));
    } else {
      if (this.playedMascotState === this.mascot.state) return;
      this.playedMascotState = this.mascot.state;
      this.mochi.setState(this.mascot.state);
    }
  }

  private refresh(): void {
    this.mochi.setShown(!this.info || this.failed);
  }

  private rememberPointer(x: number, y: number): void {
    if (!this.layout) return;
    this.pointerScreen = {
      x: this.layout.window.x + x * this.layout.scale,
      y: this.layout.window.y + y * this.layout.scale,
    };
  }

  private placeDragged(): void {
    if (!this.layout || !this.pointerScreen || !this.press) return;
    this.dragAt = {
      x: (this.pointerScreen.x - this.layout.window.x) / this.layout.scale - this.press.offsetX,
      y: (this.pointerScreen.y - this.layout.window.y) / this.layout.scale - this.press.offsetY,
    };
    this.box.style.left = `${this.dragAt.x}px`;
    this.box.style.top = `${this.dragAt.y}px`;
  }
}

export class MinisView {
  private readonly items = new Map<string, MiniMascotView>();
  private moreBox: HTMLButtonElement | null = null;
  private claude: MascotInfo | null = null;
  private codex: MascotInfo | null = null;
  private list: readonly AgentMascot[] = [];
  private layout: CornerLayout | null = null;

  constructor(private readonly root: HTMLElement, private readonly handlers: MiniHandlers) {}

  setExports(claude: MascotInfo | null, codex: MascotInfo | null): void {
    this.claude = claude;
    this.codex = codex;
    if (this.layout) this.render(this.list, this.layout);
  }

  render(list: readonly AgentMascot[], layout: CornerLayout): void {
    this.list = list;
    this.layout = layout;
    const slots = visibleSlots(list.length);
    const shown = list.slice(0, slots.shown);
    const keys = new Set(shown.map((mascot) => mascot.key));

    for (const [key, item] of this.items) {
      if (!keys.has(key)) {
        item.remove();
        this.items.delete(key);
      }
    }

    shown.forEach((mascot, index) => {
      let item = this.items.get(mascot.key);
      if (!item) {
        item = new MiniMascotView(this.root, mascot, this.handlers);
        this.items.set(mascot.key, item);
      }
      const color = mascot.subagent
        ? colorForType(mascot.type ?? "", State.settings.subagentLooks)
        : State.tasks.find((task) => task.id === mascot.pillId)?.color ?? "#9398a1";
      item.update(
        mascot,
        exportFor(mascot.family, this.claude, this.codex),
        layout,
        layout.minis[index] ?? null,
        color,
      );
    });

    if (slots.more > 0) {
      this.moreBox ??= this.makeMoreBox();
      const rect = layout.minis[slots.shown];
      this.moreBox.textContent = `+${slots.more}`;
      this.moreBox.setAttribute("aria-label", `+${slots.more}`);
      this.moreBox.style.display = rect ? "block" : "none";
      if (rect) {
        Object.assign(this.moreBox.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.w}px`,
          height: `${rect.h}px`,
        });
      }
    } else if (this.moreBox) {
      this.moreBox.style.display = "none";
    }
  }

  pointer(x: number, y: number): void {
    for (const item of this.items.values()) item.pointer(x, y);
  }

  private makeMoreBox(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-more";
    button.addEventListener("click", () => this.handlers.more());
    this.root.append(button);
    return button;
  }
}
