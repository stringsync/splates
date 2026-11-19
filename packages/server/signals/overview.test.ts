import { describe, expect, it } from "bun:test";
import { overview } from "./overview";
import type { SignalWait } from "./types";

const NOW = Date.parse("2026-11-19T12:00:00Z");

function wait(over: Partial<SignalWait>): SignalWait {
	return {
		id: "w1",
		name: "mdom.released",
		description: "mdom on npm",
		state: "waiting",
		startedAt: "2026-11-19T11:00:00Z",
		deadline: "2026-11-19T17:00:00Z",
		since: null,
		task: null,
		...over,
	};
}

describe("overview", () => {
	it("arms a signal with a live wait, and lists it before a raised one", () => {
		const rows = overview({
			raises: {
				"core.done": [{ at: "2026-11-19T10:00:00Z", by: "t", payload: 1 }],
			},
			probes: [],
			waits: [
				{
					conversation: "c1",
					title: "bump",
					archived: false,
					task: null,
					waits: [wait({})],
				},
			],
			automations: [],
			now: NOW,
		});
		expect(rows.map((row) => [row.name, row.armed])).toEqual([
			["mdom.released", true],
			["core.done", false],
		]);
		expect(rows[0]?.project).toBe("mdom");
	});

	it("does not arm for an archived conversation or a paused automation", () => {
		const rows = overview({
			raises: {},
			probes: [],
			waits: [
				{
					conversation: "c1",
					title: null,
					archived: true,
					task: null,
					waits: [wait({})],
				},
			],
			automations: [
				{
					project: "mdom",
					id: "3",
					name: null,
					signal: "mdom.released",
					paused: true,
				},
			],
			now: NOW,
		});
		expect(rows[0]?.armed).toBe(false);
		expect(rows[0]?.subscribers.map((each) => each.state)).toEqual([
			"waiting",
			"paused",
		]);
	});

	it("drops raises older than a week, newest first", () => {
		const rows = overview({
			raises: {
				"a/b": [
					{ at: "2026-11-01T00:00:00Z", by: "old", payload: null },
					{ at: "2026-11-18T00:00:00Z", by: "x", payload: null },
					{ at: "2026-11-19T00:00:00Z", by: "y", payload: null },
				],
			},
			probes: [],
			waits: [],
			automations: [],
			now: NOW,
		});
		expect(rows[0]?.raises.map((raise) => raise.by)).toEqual(["y", "x"]);
	});
});
