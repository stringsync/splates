import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { Limits } from "./limits";

describe("Limits peak history", () => {
	it("records the highest peak within a reset cycle and tolerates reset jitter", async () => {
		const storage = new MemoryStorage();
		const limits = new Limits(storage.document("limits.json"));

		await limits.remember("codex", [
			{
				window: "10080_minutes",
				used: 0.18,
				resets: "2026-11-02T08:00:00.000Z",
				at: "2026-10-30T10:00:00.000Z",
			},
		]);
		await limits.remember("codex", [
			{
				window: "10080_minutes",
				used: 0.31,
				resets: "2026-11-02T08:03:00.000Z",
				at: "2026-11-01T18:00:00.000Z",
			},
		]);
		// A lower reading in the same cycle does not erase the observed peak.
		await limits.remember("codex", [
			{
				window: "10080_minutes",
				used: 0.25,
				resets: "2026-11-02T08:01:00.000Z",
				at: "2026-11-02T07:00:00.000Z",
			},
		]);

		const history = await limits.history();
		expect(history.codex).toEqual([
			{
				window: "10080_minutes",
				resets: "2026-11-02T08:01:00.000Z",
				peak: 0.31,
				lastAt: "2026-11-02T07:00:00.000Z",
			},
		]);
	});

	it("keeps separate entries across consecutive resets and ignores cap windows", async () => {
		const storage = new MemoryStorage();
		const limits = new Limits(storage.document("limits.json"));

		await limits.replace("claude", [
			{
				window: "seven_day",
				used: 0.82,
				resets: "2026-11-02T09:00:00.000Z",
				at: "2026-11-02T08:30:00.000Z",
			},
			{
				window: "cap:extra",
				used: 0.5,
				resets: "2026-11-02T09:00:00.000Z",
				at: "2026-11-02T08:30:00.000Z",
			},
		]);
		await limits.replace("claude", [
			{
				window: "seven_day",
				used: 0.91,
				resets: "2026-11-09T09:00:00.000Z",
				at: "2026-11-09T08:00:00.000Z",
			},
		]);

		const history = await limits.history();
		expect(history.claude).toHaveLength(2);
		expect(history.claude?.map((each) => each.peak)).toEqual([0.82, 0.91]);
	});

	it("prunes peaks older than 100 days and reads legacy limits.json without peaks", async () => {
		const storage = new MemoryStorage();
		await storage.document("limits.json").write({
			format: 1,
			agents: {
				claude: [
					{
						window: "seven_day",
						used: 0.4,
						resets: "2026-06-01T09:00:00.000Z",
						at: "2026-06-01T08:00:00.000Z",
					},
				],
			},
		});

		const limits = new Limits(storage.document("limits.json"));
		expect(await limits.history()).toEqual({});

		await limits.remember("claude", [
			{
				window: "seven_day",
				used: 0.5,
				resets: "2026-06-01T09:00:00.000Z",
				at: "2026-06-01T08:00:00.000Z",
			},
		]);
		await limits.remember("claude", [
			{
				window: "seven_day",
				used: 0.85,
				resets: "2026-11-16T09:00:00.000Z",
				at: "2026-11-16T08:00:00.000Z",
			},
		]);

		const history = await limits.history();
		expect(history.claude).toHaveLength(1);
		expect(history.claude?.[0]?.resets).toBe("2026-11-16T09:00:00.000Z");
	});
});
