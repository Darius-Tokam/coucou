import type { BotStateName } from "../core/layout";
import { State } from "../core/state";
import { t, tl } from "../i18n/i18n";
import { agentMascots, colorForType, type AgentMascot } from "../mascot/agents";
import { clear, h, svg } from "./dom";
import { ICONS } from "./icons";
import { subagentCard } from "./subagent-card";
import type { ViewActions, ViewHost } from "./views";

export { subagentCard } from "./subagent-card";

function copyMascot(mascot: AgentMascot): AgentMascot {
  return { ...mascot, steps: [...mascot.steps] };
}

function stateLabel(state: BotStateName): string {
  switch (state) {
    case "idle": return t("Idle");
    case "working": return t("Working");
    case "thinking": return t("Thinking");
    case "searching": return t("Searching…");
    case "approval": return t("Needs approval");
    case "question": return t("Question");
    case "error": return t("Error");
    case "finished": return t("finished");
    case "ratelimit": return t("Rate limit");
    case "sleeping": return t("Sleeping");
    case "dizzy": return t("Dizzy");
  }
}

export function buildSubagent(
  actions: Pick<ViewActions, "collapse" | "openPill">,
  onHeightChange: (height: number) => void,
): ViewHost {
  const body = h("div", { class: "stack subagent-card" });
  const panel = h("div", { class: "card subagent-panel-card" }, body);
  const el = h("div", { class: "view subagent-view" }, panel);
  let shownKey: string | null = null;
  let snapshot: AgentMascot | null = null;
  let rendered = "";

  const reportHeight = () => {
    const height = Math.ceil(panel.scrollHeight);
    if (height > 0) onHeightChange(height);
  };
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reportHeight).observe(panel);
  }

  return {
    el,
    sync() {
      const key = State.miniCardKey;
      if (key !== shownKey) {
        shownKey = key;
        snapshot = null;
        rendered = "";
      }
      if (!key) {
        clear(body);
        return;
      }
      const live = agentMascots.list.find((mascot) => mascot.key === key);
      if (live) snapshot = copyMascot(live);
      if (!snapshot) return;
      const mascot = snapshot;
      const color = mascot.subagent
        ? colorForType(mascot.type ?? "", State.settings.subagentLooks)
        : State.tasks.find((task) => task.id === mascot.pillId)?.color ?? "#9398a1";
      const card = subagentCard(mascot, color);
      const renderKey = JSON.stringify(card);
      if (renderKey === rendered) {
        reportHeight();
        return;
      }
      rendered = renderKey;
      clear(body);
      const title = h(
        "div",
        { class: "subagent-title" },
        h("i", { class: "mini-dot", style: `background:${card.color}` }),
        h("span", { class: "title", text: card.title }),
        h("span", { class: "sub", text: `${card.project} · ${stateLabel(card.state)}` }),
        h(
          "button",
          {
            class: "subagent-close",
            type: "button",
            title: tl("Close"),
            "aria-label": tl("Close"),
            onclick: () => actions.collapse(),
          },
          svg(ICONS.xmark, 13),
        ),
      );
      const steps = h("div", { class: "subagent-steps" });
      for (const step of card.steps) steps.append(h("div", { class: "sub", text: step }));
      const answer = h("div", {
        class: "subagent-answer",
        text: card.finalText ?? "",
      });
      const session = h(
        "button",
        {
          class: "btn secondary",
          type: "button",
          onclick: () => snapshot && actions.openPill(snapshot.pillId),
        },
        h("span", { text: tl("Open session") }),
      );
      body.append(title, steps, answer, h("div", { class: "actions" }, session));
      reportHeight();
    },
  };
}
