import type { MascotInfo, MascotSlot } from "../core/bridge";
import type { BotStateName } from "../core/layout";

export type MascotFamily = MascotSlot;

export const MINI_LIMIT = 8;
export const LEAVE_MS = 3000;
export const FINISHED_MS = 3000;
export const SLEEP_MS = 120_000;
export const STALE_MS = 1_800_000;

export function familyOf(coucouAgent: string | undefined): MascotFamily | null {
  if (coucouAgent == null || coucouAgent === "" || coucouAgent === "claude-desktop") return "claude";
  if (coucouAgent === "codex") return "codex";
  return null;
}

export interface AgentEvent {
  family: MascotFamily;
  pillId: string;
  name: string;
  sessionId: string;
  agentId: string | null;
  agentType: string | null;
  project: string;
  tool: string | null;
}

export function agentEventFrom(
  p: {
    hook_event_name?: string;
    session_id?: string;
    agent_id?: string;
    agent_type?: string;
    coucou_agent?: string;
    tool_name?: string;
  },
  pillId: string,
  project: string,
): AgentEvent | null {
  const family = familyOf(p.coucou_agent);
  if (!family || !p.session_id) return null;
  return {
    family,
    pillId,
    name: p.hook_event_name ?? "",
    sessionId: p.session_id,
    agentId: p.agent_id ?? null,
    agentType: p.agent_type ?? null,
    project,
    tool: p.tool_name ?? null,
  };
}

export interface AgentMascot {
  key: string;
  family: MascotFamily;
  pillId: string;
  label: string;
  subagent: boolean;
  state: BotStateName;
}

interface TrackedMascot extends AgentMascot {
  lastEventAt: number;
  transitionAt: number | null;
  removeAt: number | null;
}

const DEPARTURES = new Set(["SubagentStop", "SessionEnd"]);

function stateFor(e: AgentEvent): BotStateName | null {
  switch (e.name) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
      return "thinking";
    case "PreToolUse":
      return e.tool === "ask_question" || e.tool?.endsWith(":ask_question") ? "question" : "working";
    case "PostToolUse":
    case "PostToolUseFailure":
    case "SubagentStart":
      return "working";
    case "PermissionRequest":
      return "approval";
    case "Stop":
    case "SubagentStop":
    case "SessionEnd":
      return "finished";
    default:
      return null;
  }
}

export class AgentMascots {
  private readonly entries: TrackedMascot[] = [];

  apply(e: AgentEvent, now: number): boolean {
    if (e.agentType === "" && (e.name === "SubagentStart" || e.name === "SubagentStop")) return false;

    const subagent = e.agentId != null && e.agentId !== "" && e.agentType !== "";
    const key = subagent
      ? `${e.family}:${e.sessionId}:${e.agentId}`
      : `${e.family}:${e.sessionId}`;
    let mascot = this.entries.find((item) => item.key === key);
    if (!mascot && DEPARTURES.has(e.name)) return false;

    let changed = false;
    if (!mascot) {
      mascot = {
        key,
        family: e.family,
        pillId: e.pillId,
        label: subagent ? (e.agentType ?? e.project) : e.project,
        subagent,
        state: stateFor(e) ?? "idle",
        lastEventAt: now,
        transitionAt: null,
        removeAt: null,
      };
      this.entries.push(mascot);
      changed = true;
    }

    mascot.lastEventAt = now;
    mascot.transitionAt = null;
    mascot.removeAt = null;
    const state = stateFor(e);
    if (state && mascot.state !== state) {
      mascot.state = state;
      changed = true;
    }
    if (e.name === "Stop") mascot.transitionAt = now + FINISHED_MS;
    if (DEPARTURES.has(e.name)) mascot.removeAt = now + LEAVE_MS;
    return changed;
  }

  tick(now: number): boolean {
    let changed = false;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const mascot = this.entries[i];
      if ((mascot.removeAt != null && now >= mascot.removeAt) || now >= mascot.lastEventAt + STALE_MS) {
        this.entries.splice(i, 1);
        changed = true;
        continue;
      }
      if (mascot.transitionAt != null && now >= mascot.transitionAt) {
        mascot.transitionAt = null;
        if (mascot.state !== "idle") {
          mascot.state = "idle";
          changed = true;
        }
      }
      if (mascot.state === "idle" && now >= mascot.lastEventAt + SLEEP_MS) {
        mascot.state = "sleeping";
        changed = true;
      }
    }
    return changed;
  }

  get list(): readonly AgentMascot[] {
    return this.entries;
  }

  nextChangeAt(): number | null {
    let next: number | null = null;
    const take = (time: number) => {
      if (next == null || time < next) next = time;
    };
    for (const mascot of this.entries) {
      take(mascot.lastEventAt + STALE_MS);
      if (mascot.state === "idle") take(mascot.lastEventAt + SLEEP_MS);
      if (mascot.transitionAt != null) take(mascot.transitionAt);
      if (mascot.removeAt != null) take(mascot.removeAt);
    }
    return next;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export function visibleSlots(count: number): { shown: number; more: number } {
  const shown = Math.min(count, MINI_LIMIT);
  return { shown, more: count - shown };
}

export function exportFor(
  family: MascotFamily,
  claude: MascotInfo | null,
  codex: MascotInfo | null,
): MascotInfo | null {
  return family === "codex" ? (codex ?? claude) : claude;
}

export const agentMascots = new AgentMascots();
