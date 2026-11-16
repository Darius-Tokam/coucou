// Which state of a MascotForge export plays for each of Coucou's states.
// Exports name their states differently (blob: listening, done; 3D: speaking,
// celebrating; a video may have only idle, thinking, talking, error), so each
// Coucou state tries names in order and keeps the first the export has.

import type { BotStateName } from "../core/layout";

export const MASCOT_STATE_FALLBACKS: Record<BotStateName, readonly string[]> = {
  idle: ["idle"],
  working: ["working", "thinking"],
  thinking: ["thinking", "working"],
  searching: ["thinking", "working"],
  approval: ["listening", "surprised", "talking"],
  question: ["listening", "talking", "surprised"],
  error: ["error", "sad"],
  finished: ["done", "happy", "celebrating"],
  ratelimit: ["sad", "error", "sleeping"],
  sleeping: ["sleeping", "idle"],
  dizzy: ["surprised", "error"],
};

/** The export's state for `state`, or its default state when none fits. */
export function resolveMascotState(
  state: BotStateName,
  available: readonly string[],
  defaultState: string,
): string {
  return MASCOT_STATE_FALLBACKS[state].find((name) => available.includes(name)) ?? defaultState;
}

/** From what needs you most to what needs you least. */
const AGENT_PRIORITY: readonly BotStateName[] = [
  "approval", "question", "error", "ratelimit", "working", "thinking", "searching",
  "dizzy", "finished", "idle", "sleeping",
];

/**
 * The corner mascot stands for every agent at once: it shows the one that
 * needs you most, not the pill the panel happens to show. A state Coucou
 * forces (`override`) still wins.
 */
export function cornerAgentState(states: readonly BotStateName[], override: BotStateName | null): BotStateName {
  if (override) return override;
  return AGENT_PRIORITY.find((s) => states.includes(s)) ?? "idle";
}

/**
 * Under the pointer, a calm mascot reacts: the export's own `hover` state, or
 * a startled look (3D: a little hop, wide eyes on the cursor), or listening.
 */
export const MASCOT_HOVER_STATES: readonly string[] = ["hover", "surprised", "listening", "happy"];

/** Only these give way to the hover: an agent at work keeps showing it. */
const HOVER_OVERRIDES: readonly BotStateName[] = ["idle", "sleeping"];

/** What the export plays for `state`, the pointer being on the mascot or not. */
export function mascotStateFor(
  state: BotStateName,
  hovered: boolean,
  available: readonly string[],
  defaultState: string,
): string {
  if (hovered && HOVER_OVERRIDES.includes(state)) {
    const hover = MASCOT_HOVER_STATES.find((name) => available.includes(name));
    if (hover) return hover;
  }
  return resolveMascotState(state, available, defaultState);
}

/** Approvals and questions don't wait for a video clip to finish. */
export function playsImmediately(state: BotStateName): boolean {
  return state === "approval" || state === "question";
}

/** A sleeping mascot keeps its last frame until the pointer wakes it. */
export function shouldPause(state: BotStateName, hovered: boolean): boolean {
  return state === "sleeping" && !hovered;
}
