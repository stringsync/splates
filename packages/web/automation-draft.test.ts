import { describe, expect, it } from "bun:test";
import { AutomationDraft } from "./automation-draft";

describe("AutomationDraft", () => {
	it("makes a filtered event trigger, and a schedule, from what the form holds", () => {
		const draft = new AutomationDraft();
		draft.set("stage", "backlog");
		draft.set("lane", "3");
		draft.set("pick", { agent: "claude", effort: "high" });
		draft.set("prompt", "groom it");

		expect(draft.made()).toEqual({
			trigger: {
				event: "task.created",
				filter: { stages: ["backlog"], lanes: [3] },
			},
			hook: {
				kind: "agent",
				prompt: "groom it",
				agent: "claude",
				effort: "high",
			},
		});

		draft.set("when", "cron");
		draft.set("schedule", "0 9 * * 1-5");
		draft.set("kind", "run");
		draft.set("command", "standup");

		expect(draft.made()).toEqual({
			trigger: { cron: "0 9 * * 1-5" },
			hook: { kind: "run", command: "standup" },
		});
	});

	it("asks for an agent before it makes an agent hook", () => {
		expect(() => new AutomationDraft().made()).toThrow("pick the agent");
	});
});
