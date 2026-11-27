import { describe, expect, it } from "bun:test";
import { changed, type HookChange } from "./edit";
import type { Automation } from "./store";

describe("changed", () => {
	it("leaves alone what no flag names", () => {
		expect(changed(NOTIFY, NONE)).toEqual({
			trigger: NOTIFY.trigger,
			hook: NOTIFY.hook,
		});
	});

	it("narrows the event anew, `any` taking a narrowing away", () => {
		expect(
			changed(NOTIFY, { ...NONE, stage: "any", lane: "2,3" }).trigger,
		).toEqual({
			event: "task.created",
			filter: { lanes: [2, 3] },
		});
		expect(
			changed(NOTIFY, { ...NONE, event: "task.done", stage: "queued" }).trigger,
		).toEqual({ event: "task.done", filter: { stages: ["queued"] } });
		expect(() => changed(NOTIFY, { ...NONE, every: "1h", lane: "2" })).toThrow(
			"not a schedule",
		);
		expect(() =>
			changed(NOTIFY, { ...NONE, every: "1h", cron: "* * * * *" }),
		).toThrow("one of them");
	});

	it("narrows the event to Backlog, lane 0, refusing a negative lane", () => {
		expect(
			changed(NOTIFY, { ...NONE, stage: "any", lane: "0" }).trigger,
		).toEqual({ event: "task.created", filter: { lanes: [0] } });
		expect(() => changed(NOTIFY, { ...NONE, lane: "-1" })).toThrow(
			"no list of lane numbers",
		);
	});

	it("sets an event to run on every Nth match, `any` taking that away", () => {
		expect(changed(NOTIFY, { ...NONE, invokes: "10" }).trigger).toEqual({
			event: "task.created",
			filter: { stages: ["available"] },
			invokes: 10,
		});
		const counted: Automation = {
			...NOTIFY,
			trigger: { event: "task.done", invokes: 10 },
		};
		expect(changed(counted, { ...NONE, lane: "2" }).trigger).toEqual({
			event: "task.done",
			filter: { lanes: [2] },
			invokes: 10,
		});
		expect(changed(counted, { ...NONE, invokes: "any" }).trigger).toEqual({
			event: "task.done",
		});
		expect(() => changed(NOTIFY, { ...NONE, invokes: "0" })).toThrow(
			"no count",
		);
		expect(() =>
			changed(NOTIFY, { ...NONE, every: "1h", invokes: "3" }),
		).toThrow("not a schedule");
	});

	it("changes an agent's prompt or agent, keeping the other", () => {
		expect(changed(NOTIFY, { ...NONE, prompt: "say bye" }).hook).toEqual({
			kind: "agent",
			prompt: "say bye",
			agent: "claude",
			model: "sonnet",
		});
		expect(changed(NOTIFY, { ...NONE, pick: { agent: "codex" } }).hook).toEqual(
			{ kind: "agent", prompt: "say hi", agent: "codex" },
		);
	});

	it("moves an agent hook onto Autopick, keeping its prompt", () => {
		expect(changed(NOTIFY, { ...NONE, pick: null }).hook).toEqual({
			kind: "agent",
			prompt: "say hi",
		});
	});

	it("turns an agent into a command, and back only with a prompt", () => {
		const run = changed(NOTIFY, { ...NONE, run: "notify" });
		expect(run.hook).toEqual({ kind: "run", command: "notify" });
		const command = { ...NOTIFY, hook: run.hook };
		expect(() =>
			changed(command, { ...NONE, pick: { agent: "claude" } }),
		).toThrow("with --prompt");
		expect(changed(command, { ...NONE, prompt: "hi" }).hook).toEqual({
			kind: "agent",
			prompt: "hi",
		});
		expect(
			changed(command, { ...NONE, prompt: "hi", pick: { agent: "claude" } })
				.hook,
		).toEqual({ kind: "agent", prompt: "hi", agent: "claude" });
	});
});

const NONE: HookChange = {
	event: "",
	every: "",
	cron: "",
	stage: "",
	lane: "",
	invokes: "",
	prompt: "",
	run: "",
};

const NOTIFY: Automation = {
	id: "1",
	trigger: { event: "task.created", filter: { stages: ["available"] } },
	hook: { kind: "agent", prompt: "say hi", agent: "claude", model: "sonnet" },
	createdAt: "2026-10-19T00:00:00.000Z",
};
