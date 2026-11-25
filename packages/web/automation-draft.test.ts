import { describe, expect, it } from "bun:test";
import { AutomationDraft } from "./automation-draft";

describe("AutomationDraft", () => {
	it("makes a filtered event trigger, and a schedule, from what the form holds", () => {
		const draft = new AutomationDraft();
		draft.set("stage", "available");
		draft.set("lane", "3");
		draft.set("pick", { agent: "claude", effort: "high" });
		draft.set("prompt", "groom it");

		expect(draft.made()).toEqual({
			name: "",
			trigger: {
				event: "task.created",
				filter: { stages: ["available"], lanes: [3] },
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
			name: "",
			trigger: { cron: "0 9 * * 1-5" },
			hook: { kind: "run", command: "standup" },
		});
	});

	it("holds what an automation sets off and runs, to make it again", () => {
		const made = {
			trigger: {
				event: "task.done" as const,
				filter: {
					stages: ["available" as const, "queued" as const],
					lanes: [2],
				},
			},
			hook: {
				kind: "agent" as const,
				prompt: "wrap up",
				agent: "claude",
				model: "sonnet",
			},
		};
		const draft = AutomationDraft.of({ id: "1", createdAt: "", ...made });
		expect(draft.fields).toMatchObject({
			stage: "available,queued",
			lane: "2",
		});
		expect(draft.made()).toEqual({ ...made, name: "" });

		const tidy = {
			trigger: { cron: "0 9 * * *" },
			hook: { kind: "run" as const, command: "tidy" },
		};
		expect(
			AutomationDraft.of({ id: "2", createdAt: "", ...tidy }).made(),
		).toEqual({ ...tidy, name: "" });
	});

	it("keeps the name it is given, trimmed, and edits it back", () => {
		const draft = new AutomationDraft();
		draft.set("name", "  Standup  ");
		draft.set("when", "cron");
		draft.set("schedule", "0 9 * * 1-5");
		draft.set("kind", "run");
		draft.set("command", "standup");
		expect(draft.made().name).toBe("Standup");
		const made = draft.made();
		expect(
			AutomationDraft.of({ id: "1", createdAt: "", ...made }).fields.name,
		).toBe("Standup");
	});

	it("makes an agent hook on Auto pick when no agent is picked", () => {
		const draft = new AutomationDraft();
		draft.set("prompt", "look");
		expect(draft.made().hook).toEqual({ kind: "agent", prompt: "look" });
	});

	it("keeps an Auto pick hook on Auto pick when it edits one", () => {
		const draft = AutomationDraft.of({
			id: "1",
			trigger: { signal: "mdom.released" },
			hook: { kind: "agent", prompt: "adopt it" },
			createdAt: "2026-11-22T00:00:00.000Z",
		});
		expect(draft.fields.pick).toBeNull();
		expect(draft.made().hook).toEqual({ kind: "agent", prompt: "adopt it" });
	});

	it("keeps a per-firing eval budget on an agent hook and rejects invalid amounts", () => {
		const draft = new AutomationDraft();
		draft.set("prompt", "run evals");
		draft.set("evalBudget", "$2");
		const made = draft.made();
		expect(made.hook).toEqual({
			kind: "agent",
			prompt: "run evals",
			evalBudget: 2,
		});
		const edited = AutomationDraft.of({
			id: "1",
			createdAt: "",
			...made,
		});
		expect(edited.fields.evalBudget).toBe("2");
		expect(edited.made().hook).toEqual(made.hook);

		draft.set("evalBudget", "0");
		expect(() => draft.made()).toThrow("above 0");
		draft.added();
		expect(draft.fields.evalBudget).toBe("");
	});
});
