import type { BotStateName } from "../core/layout";
import { BotEngine } from "../mochi/engine";

const FRAME_MS = 1000 / 30;

export class MochiCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly mochi = new BotEngine();
  private shown = false;
  private timer: number | null = null;
  private lastDraw = 0;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mascot-mochi";
    this.container.append(this.canvas);
  }

  setShown(on: boolean): void {
    this.shown = on;
    this.canvas.style.display = on ? "block" : "none";
    if (on) this.schedule();
    else if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setState(state: BotStateName): void {
    this.mochi.setState(state);
  }

  private schedule(): void {
    if (this.timer != null) return;
    const due = Math.max(0, this.lastDraw + FRAME_MS - performance.now());
    this.timer = window.setTimeout(() => {
      requestAnimationFrame((now) => {
        this.timer = null;
        if (!this.shown) return;
        this.draw(now);
        this.schedule();
      });
    }, due);
  }

  private draw(now: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    const size = this.container.clientWidth || 200;
    const drawW = size * 0.8;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const side = Math.round(size * dpr);
    if (this.canvas.width !== side || this.canvas.height !== side) {
      this.canvas.width = side;
      this.canvas.height = side;
    }
    this.mochi.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, ((size - drawW) / 2) * dpr, 0);
    ctx.clearRect(-(size - drawW) / 2, 0, size, size);
    this.mochi.draw(ctx, drawW, size);
  }
}
