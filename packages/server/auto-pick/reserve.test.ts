import { describe, expect, it } from "bun:test";
import { reserveHold } from "./reserve";
import type { AutoPickRules } from "./rules";

const rules = {
	lineups: [{ id: "a", picks: [{ agent: "claude" }, { agent: "codex" }] }],
} as unknown as AutoPickRules;
const now = new Date("2026-11-23T12:00:00Z");
const later = "2026-11-23T15:00:00Z";
const base = {
	reserve: 0.25,
	named: undefined,
	rules,
	runnable: ["claude", "codex"],
	now,
};
const window = (used: number, resets: string | null = later) => ({
	window: "five_hour",
	used,
	resets,
	at: null,
});

describe("reserveHold", () => {
	it("holds when every agent has less than the reserve left", () => {
		const hold = reserveHold({
			...base,
			limits: { claude: [window(0.9)], codex: [window(0.8)] },
		});
		expect(hold?.agents.map((each) => each.agent)).toEqual(["claude", "codex"]);
		expect(hold?.frees).toBe(later);
	});

	it("starts when one agent still has room", () => {
		expect(
			reserveHold({
				...base,
				limits: { claude: [window(0.9)], codex: [window(0.2)] },
			}),
		).toBeNull();
	});

	it("treats an agent with no window as having room, and a reset window as full", () => {
		expect(
			reserveHold({ ...base, limits: { claude: [window(0.9)] } }),
		).toBeNull();
		expect(
			reserveHold({
				...base,
				limits: {
					claude: [window(0.9, "2026-11-23T11:00:00Z")],
					codex: [window(0.9)],
				},
			}),
		).toBeNull();
	});

	it("looks only at the agent a task names", () => {
		expect(
			reserveHold({
				...base,
				named: { agent: "claude" },
				limits: { claude: [window(0.9)], codex: [window(0.1)] },
			})?.agents,
		).toHaveLength(1);
	});

	it("holds nothing with a zero reserve", () => {
		expect(
			reserveHold({ ...base, reserve: 0, limits: { claude: [window(1)] } }),
		).toBeNull();
	});
});
