import { describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { FakeFs } from "core/system/testing";
import { MemoryStorage } from "../storage/testing";
import { type Cascade, Cascades } from "./cascade";
import { CascadeRoutes } from "./cascade-routes";
import type { ReleaseStep } from "./release-steps";
import { OUTSIDE_STEPS, pendingStage } from "./stages";

describe("legacy ship history", () => {
	it("ignores old active cascade and planning records while keeping history readable", async () => {
		const storage = new MemoryStorage();
		const fs = new FakeFs();
		await storage
			.document("ship-cascade.json")
			.write({ ...legacy, status: "running" });
		await storage.document("ship-run.json").write({ state: "running" });
		const cascades = new Cascades(storage, fs);
		await cascades.history.file(legacy);
		expect(await cascades.current()).toBeNull();
		expect(await cascades.shown()).toEqual({ cascade: null, ship: null });
		const routes = new CascadeRoutes(cascades);
		expect(await (await routes.history()).json()).toMatchObject([
			{ id: legacy.id, status: "stopped" },
		]);
		expect(
			await (
				await routes.historyEntry(
					new Request(`http://localhost/api/legacy-ship/history/${legacy.id}`),
				)
			).json(),
		).toEqual({ cascade: legacy, ship: null });
		expect(
			routes.historyEntry(
				new Request("http://localhost/api/legacy-ship/history/missing"),
			),
		).rejects.toMatchObject({ reason: "not_found" });
	});

	it("reads legacy stage logs and expected durations, and prunes the oldest history", async () => {
		const fs = new FakeFs();
		const cascades = new Cascades(new MemoryStorage(), fs);
		await cascades.history.file(legacy);
		await fs.write(
			cascades.history.logOf(legacy.id, "example"),
			"signed in\npublished\n",
		);
		expect(await cascades.stageLog(legacy.id, "example", "command")).toBe(
			"published\n",
		);
		expect(await cascades.stageLog("missing", "example", "command")).toBeNull();
		expect(await cascades.history.expected("example", "command")).toEqual({
			expected: 120_000,
			known: true,
		});
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				cascades.history.file({
					...legacy,
					id: `2026-09-${String(i + 1).padStart(2, "0")}-example`,
				}),
			),
		);
		await cascades.history.prune();
		const kept = await cascades.history.summaries();
		expect(kept).toHaveLength(20);
		expect(kept[0]?.id).toBe(legacy.id);
		expect(await cascades.history.read("2026-09-01-example")).toBeNull();
	});

	it("reads a release step's slice of its stage's log, and what came outside every step", async () => {
		const fs = new FakeFs();
		const cascades = new Cascades(new MemoryStorage(), fs);
		const release = (id: string, from: number, to: number): ReleaseStep => ({
			id,
			name: id,
			stage: "build",
			packages: [],
			state: "done",
			started: legacy.started,
			ended: legacy.started,
			deadlineMs: 1000,
			checked: null,
			status: null,
			url: null,
			error: null,
			staged: [],
			log: { from, to },
		});
		const step = ensure.defined(legacy.steps[0]);
		const stage = ensure.defined(step.stages[0]);
		const cascade: Cascade = {
			...legacy,
			steps: [
				{
					...step,
					stages: [
						{
							...stage,
							log: { from: 0, to: 22 },
							releaseSteps: [release("build", 4, 10), release("tag", 10, 15)],
						},
					],
				},
			],
		};
		await cascades.history.file(cascade);
		// Bytes: "pre\n" 0-4, "build\n" 4-10, "tag\n\n" 10-15, "summary" 15-22.
		await fs.write(
			cascades.history.logOf(legacy.id, "example"),
			"pre\nbuild\ntag\n\nsummary",
		);
		const read = (release: string) =>
			cascades.stageLog(legacy.id, "example", "command", release);
		expect(await read("build")).toBe("build\n");
		expect(await read("tag")).toBe("tag\n\n");
		expect(await read(OUTSIDE_STEPS)).toBe("pre\nsummary");
		expect(await read("missing")).toBeNull();
	});

	it("shows records that predate stage tracking", async () => {
		const cascades = new Cascades(new MemoryStorage(), new FakeFs());
		await cascades.history.file({
			...legacy,
			steps: legacy.steps.map(({ stages: _stages, ...step }) => step),
		} as Cascade);
		expect((await cascades.kept(legacy.id))?.cascade.steps[0]?.stages).toEqual(
			[],
		);
	});
});

const legacy: Cascade = {
	id: "2026-10-27T12-00-00-000Z-example",
	from: "example",
	status: "stopped",
	started: "2026-10-27T12:00:00.000Z",
	ended: "2026-10-27T12:02:00.000Z",
	steps: [
		{
			slug: "example",
			action: "ship",
			from: "1.0.0",
			to: "1.0.1",
			bump: "patch",
			publishes: ["example"],
			takes: [],
			why: "the project shipped",
			status: "failed",
			task: null,
			ship: null,
			published: [],
			note: "publish failed",
			stages: [
				{
					...pendingStage("command"),
					state: "done",
					started: "2026-10-27T12:00:00.000Z",
					ended: "2026-10-27T12:02:00.000Z",
					log: { from: 10, to: null },
				},
			],
		},
	],
};
