import { describe, expect, it } from "bun:test";
import type { Progress } from "@splates/server/conversations";
import { backgrounded } from "./progress";

const card = (overrides: Partial<Progress> = {}): Progress => ({
	id: "build",
	title: "Import fixtures",
	state: "running",
	percent: 40,
	note: "parsing score-05",
	startedAt: "2026-11-04T10:00:00Z",
	updatedAt: "2026-11-04T10:01:00Z",
	history: [{ at: "2026-11-04T10:00:30Z", note: "parsing score-04" }],
	...overrides,
});

describe("backgrounded", () => {
	it("is true while a progress card runs, with no background command", () => {
		expect(backgrounded({ background: [], progress: [card()] })).toBe(true);
	});

	it("is false once every card has finished, failed or stopped", () => {
		const progress = (["done", "failed", "stopped"] as const).map((state) =>
			card({ id: state, state }),
		);

		expect(backgrounded({ background: [], progress })).toBe(false);
	});

	it("is true for a running background command with no card", () => {
		expect(
			backgrounded({
				background: [
					{
						id: "b1",
						name: "tests",
						command: null,
						subagent: null,
						state: "running",
						output: null,
					},
				],
				progress: [],
			}),
		).toBe(true);
	});
});
