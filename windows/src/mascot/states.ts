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

/** Approvals and questions don't wait for a video clip to finish. */
export function playsImmediately(state: BotStateName): boolean {
  return state === "approval" || state === "question";
}
