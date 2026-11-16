import type { BotStateName } from "../core/layout";
import type { AgentMascot } from "../mascot/agents";

export interface SubagentCard {
  title: string;
  color: string;
  state: BotStateName;
  project: string;
  steps: readonly string[];
  finalText: string | null;
}

export function subagentCard(mascot: AgentMascot, color: string): SubagentCard {
  return {
    title: mascot.subagent ? mascot.label : mascot.family === "codex" ? "Codex" : "Claude Code",
    color,
    state: mascot.state,
    project: mascot.project,
    steps: mascot.steps,
    finalText: mascot.finalText,
  };
}
