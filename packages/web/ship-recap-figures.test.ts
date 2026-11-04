import { describe, expect, it } from "bun:test";
import type { Cascade, Stage } from "@splates/server/ship";
import { lasted, recapOf } from "./ship-recap-figures";

describe("recapOf", () => {
	const cascade = cascadeOf();
	const recap = recapOf(cascade, Date.parse("2026-01-02T00:00:00Z"));

	it("splits the time between the machine and the person", () => {
		expect(recap.total).toBe(1_800_000);
		expect(recap.person).toBe(120_000);
		expect(recap.machine).toBe(1_680_000);
	});

	it("names the step furthest past its expected time", () => {
		expect(recap.slowest?.project).toBe("mdom");
		expect(recap.slowest?.row.key).toBe("gate");
	});

	it("keeps every step that ran and folds a clean project", () => {
		expect(recap.projects[0]?.rows.map((row) => row.key)).toEqual([
			"bump",
			"gate",
			"otp",
			"merged",
		]);
		expect(recap.projects[0]?.clean).toBe(false);
		expect(recap.projects[1]?.clean).toBe(true);
	});

	it("notes the projects an agent adopted and reports no errors", () => {
		expect(recap.agents).toEqual(["vexml"]);
		expect(recap.errors).toEqual([]);
	});

	it("reports a failed step with the project's note", () => {
		const failed = structuredClone(cascade);
		const [first] = failed.steps;
		first?.stages.push(
			stage(
				"command",
				"2026-01-01T00:27:00Z",
				"2026-01-01T00:28:00Z",
				300_000,
				"failed",
			),
		);
		expect(
			recapOf(
				{
					...failed,
					steps: [{ ...first, note: "build broke\nmore" } as never],
				},
				0,
			).errors,
		).toEqual([{ project: "mdom", text: "command failed: build broke" }]);
	});

	it("reads seconds, minutes and hours", () => {
		expect(lasted(41_000)).toBe("41s");
		expect(lasted(1_325_000)).toBe("22m 05s");
		expect(lasted(3_720_000)).toBe("1h 02m");
	});
});

function stage(
	key: Stage["key"],
	started: string,
	ended: string,
	expected: number,
	state: Stage["state"] = "done",
): Stage {
	return {
		key,
		name: key,
		state,
		started,
		ended,
		expected,
		known: true,
		deadline: null,
		check: null,
		log: null,
	};
}

function cascadeOf(): Cascade {
	return {
		id: "c",
		from: "mdom",
		status: "done",
		started: "2026-01-01T00:00:00Z",
		ended: "2026-01-01T00:30:00Z",
		steps: [
			{
				slug: "mdom",
				status: "done",
				note: null,
				stages: [
					stage(
						"bump",
						"2026-01-01T00:00:00Z",
						"2026-01-01T00:05:00Z",
						1_200_000,
					),
					stage(
						"gate",
						"2026-01-01T00:05:00Z",
						"2026-01-01T00:25:00Z",
						600_000,
					),
					stage("otp", "2026-01-01T00:25:00Z", "2026-01-01T00:27:00Z", 120_000),
					stage("merged", "2026-01-01T00:27:00Z", "2026-01-01T00:27:00Z", 0),
				],
			},
			{
				slug: "vexml",
				status: "done",
				note: null,
				adopt: "agent",
				stages: [
					stage(
						"bump",
						"2026-01-01T00:00:00Z",
						"2026-01-01T00:01:00Z",
						1_200_000,
					),
				],
			},
		],
	} as unknown as Cascade;
}
