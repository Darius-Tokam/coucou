// Dan the Lion — Darius's MascotForge lion, replacing Mochi as the main
// character of the Windows app.
//
// The lion art lives in `assets/`, copied from MascotForge
// (`mascot-forge/demo/lion/couches/`): `lion-corps.png` is the full-body
// lion (RGBA, content box 344x605 in a 640x640 layer), `lion-coeur.png`
// is the red heart on its chest as its own layer (alpha = heart only),
// so the heart can beat on its own.
//
// How the swap works: the engine keeps its whole state machine — states,
// tweens, bounces, dance, badges, particles — and only the procedural
// body drawing is replaced by these two images. The mini bots (integration
// pills) keep their flat coloured Mochi bodies, so each service keeps its
// colour. Set LION_CHARACTER to false to go back to Mochi.

import lionCorpsUrl from "./assets/lion-corps.png";
import lionCoeurUrl from "./assets/lion-coeur.png";
import type { BotStateName } from "../core/layout";

/** The main character. `false` restores Mochi, the original character. */
export const LION_CHARACTER = true;

export interface LionImages {
  corps: HTMLImageElement;
  coeur: HTMLImageElement;
}

let cache: LionImages | null = null;
let loadingStarted = false;

/**
 * Starts loading the lion layers on first call (async, the island redraws
 * every frame) and returns them once both are ready, `null` before that.
 * Returns `null` forever when LION_CHARACTER is off.
 */
export function getLionImages(): LionImages | null {
  if (!LION_CHARACTER) return null;
  if (cache) return cache;
  if (!loadingStarted) {
    loadingStarted = true;
    const corps = new Image();
    const coeur = new Image();
    let loaded = 0;
    const done = () => {
      if (++loaded === 2) cache = { corps, coeur };
    };
    corps.onload = done;
    coeur.onload = done;
    corps.src = lionCorpsUrl;
    coeur.src = lionCoeurUrl;
  }
  return null;
}

// Centre of the heart in the 640x640 layer, as a fraction of the drawn
// rect — used to scale the heartbeat around the heart itself.
const HEART_CX = 291 / 640 - 0.5;
const HEART_CY = 372 / 640 - 0.5;

/**
 * Draws the lion in place of Mochi's body, inside the caller's
 * already-transformed context: translated to the character centre, tilted
 * and scaled, so bounces, approval shakes and the dance keep working.
 *
 * The lion is a full body, taller than wide, so it is fitted by height to
 * Mochi's old body box (2*ry tall, slightly overflowing so mane and paws
 * read). `yaw`/`pitch` lean it a little toward the cursor, the way Mochi's
 * eyes used to follow it.
 */
export function drawLionBody(
  x: CanvasRenderingContext2D,
  R: number,
  images: LionImages,
  opts: { state: BotStateName; yaw: number; pitch: number; nowS: number },
): void {
  const H = 2.5 * R;
  const W = H * (344 / 605);
  const dx = -W / 2 + opts.yaw * R * 0.08;
  const dy = -H / 2 + opts.pitch * R * 0.05;

  x.drawImage(images.corps, dx, dy, W, H);

  // The heart beats when the lion is happy (finished state): it scales
  // around its own centre. Otherwise it is drawn flat, exactly aligned
  // with the body layer.
  const beating = opts.state === "finished";
  const s = beating ? 1 + 0.09 * Math.sin(opts.nowS * Math.PI * 2 * 1.4) : 1;
  x.save();
  x.translate(dx + W * (HEART_CX + 0.5), dy + H * (HEART_CY + 0.5));
  x.scale(s, s);
  x.drawImage(images.coeur, -W / 2 - W * HEART_CX, -H / 2 - H * HEART_CY, W, H);
  x.restore();
}
