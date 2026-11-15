import { Bridge, type CornerLayout, type MascotInfo, type Rect } from "../core/bridge";
import { State } from "../core/state";
import { exportFor, visibleSlots, type AgentMascot } from "../mascot/agents";
import { MascotHost } from "../mascot/host";
import { mascotStateFor, playsImmediately } from "../mascot/states";
import { MochiCanvas } from "./mochi-canvas";

export interface MiniHandlers {
  open(pillId: string): void;
  more(): void;
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

  constructor(root: HTMLElement, mascot: AgentMascot, handlers: MiniHandlers) {
    this.mascot = mascot;
    this.box = document.createElement("div");
    this.box.className = "mini-box";
    this.visual = document.createElement("div");
    this.visual.className = "mini-visual";
    this.mochi = new MochiCanvas(this.visual);
    this.host = new MascotHost(this.visual);
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
      if (this.host.active) this.host.poke();
      handlers.open(this.mascot.pillId);
    });

    this.box.append(this.visual, label, this.layer);
    root.append(this.box);
  }

  update(mascot: AgentMascot, info: MascotInfo | null, rect: Rect | null, color: string): void {
    this.mascot = mascot;
    this.text.textContent = mascot.label;
    this.dot.style.background = color;
    this.layer.setAttribute("aria-label", mascot.label);
    this.rect = rect;
    this.box.style.display = rect ? "block" : "none";
    if (rect) {
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
    } else {
      if (this.playedMascotState === this.mascot.state) return;
      this.playedMascotState = this.mascot.state;
      this.mochi.setState(this.mascot.state);
    }
  }

  private refresh(): void {
    this.mochi.setShown(!this.info || this.failed);
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
      const color = State.tasks.find((task) => task.id === mascot.pillId)?.color ?? "#9398a1";
      item.update(mascot, exportFor(mascot.family, this.claude, this.codex), layout.minis[index] ?? null, color);
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
