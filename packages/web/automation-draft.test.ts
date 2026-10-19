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

	it("holds what an automation sets off and runs, to make it again", () => {
		const made = {
			trigger: {
				event: "task.done" as const,
				filter: { stages: ["ready" as const, "queued" as const], lanes: [2] },
			},
			hook: {
				kind: "agent" as const,
				prompt: "wrap up",
				agent: "claude",
				model: "sonnet",
			},
		};
		const draft = AutomationDraft.of({ id: "1", createdAt: "", ...made });
		expect(draft.fields).toMatchObject({ stage: "ready,queued", lane: "2" });
		expect(draft.made()).toEqual(made);

		const tidy = {
			trigger: { cron: "0 9 * * *" },
			hook: { kind: "run" as const, command: "tidy" },
		};
		expect(
			AutomationDraft.of({ id: "2", createdAt: "", ...tidy }).made(),
		).toEqual(tidy);
	});

	it("asks for an agent before it makes an agent hook", () => {
		expect(() => new AutomationDraft().made()).toThrow("pick the agent");
	});
});
