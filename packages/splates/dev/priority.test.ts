import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { AgentPriority, type AgentPriorityOptions } from "./priority";

function lowered(
	env: Record<string, string>,
	opts: Pick<AgentPriorityOptions, "premerge"> = {},
): number | null {
	const ps = new FakePs();
	ps.setEnv(env);
	let nice: number | null = null;
	const priority = new AgentPriority(ps, {
		...opts,
		nicer: { renice: (to) => (nice = to) },
	});
	priority.lower();
	return nice;
}

describe("AgentPriority", () => {
	it("lowers an agent's run beside a gate to nice 10", () => {
		expect(lowered({ SPLATES_CONVERSATION: "c1" })).toBe(10);
	});

	it("keeps a gate's own run, a premerge by hand and the person's runs", () => {
		expect(
			lowered({ SPLATES_CONVERSATION: "c1", SPLATES_PREMERGE: "1" }),
		).toBeNull();
		expect(
			lowered({ SPLATES_CONVERSATION: "c1" }, { premerge: true }),
		).toBeNull();
		expect(lowered({})).toBeNull();
	});

	it("lowers once, however many runs share the process", () => {
		const ps = new FakePs();
		ps.setEnv({ SPLATES_CONVERSATION: "c1" });
		const renices: number[] = [];
		const priority = new AgentPriority(ps, {
			nicer: { renice: (to) => renices.push(to) },
		});
		expect(priority.lower()).toBe(true);
		expect(priority.lower()).toBe(false);
		expect(renices).toEqual([10]);
	});
});
