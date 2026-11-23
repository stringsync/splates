import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { NodePs } from "core/system";
import { launch, launcherOf } from "../agents/process";
import { MemoryStorage } from "../storage/testing";
import { RigCommands } from "./commands";
import { type RigPresets, RigRoutes, type RigsPage } from "./routes";
import { type KeptRun, RigRuns } from "./runs";

const fixture = `bun ${join(import.meta.dir, "fixtures/rig.ts")}`;

describe("RigRoutes", () => {
	let runs: RigRuns | null = null;

	afterEach(() => {
		runs?.dispose();
		runs = null;
	});

	function routes(): RigRoutes {
		const ps = new NodePs();
		const trees = async () => [{ name: "main", path: import.meta.dir }];
		const commands = new RigCommands([fixture], ps, import.meta.dir);
		runs = new RigRuns({
			listing: () => commands.list(),
			trees,
			launcher: launcherOf(launch),
			kept: new MemoryStorage().document<KeptRun[]>("rig-runs.json"),
			ps,
			base: null,
		});
		return new RigRoutes({
			commands,
			trees,
			presets: new MemoryStorage().document<RigPresets>("rig-presets.json"),
			runs,
		});
	}

	const post = (body: unknown, method = "POST") =>
		new Request("http://x/", { method, body: JSON.stringify(body) });

	it("lists the rigs with the trees and runs, and starts one only once per tree", async () => {
		const rigs = routes();
		const page = (await (
			await rigs.rigs(new Request("http://x/api/rigs"))
		).json()) as RigsPage;
		expect(page.groups.map((group) => group.name)).toEqual(["fixture"]);
		expect(page.trees).toEqual(["main"]);
		expect(page.runs).toEqual([]);
		const start = { group: "fixture", rig: "echo", tree: "main" };
		expect((await rigs.start(post(start))).status).toBe(200);
		const again = await rigs.start(post(start));
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({
			error: "Echo server already runs on main",
		});
		expect(
			(await rigs.start(post({ ...start, values: { mode: "c" } }))).status,
		).toBe(409);
		expect((await rigs.stop(post({ id: "fixture/echo@main" }))).status).toBe(
			200,
		);
		expect((await rigs.stop(post({ id: "nothing" }))).status).toBe(404);
	});

	it("refuses a value its rig does not take", async () => {
		const rigs = routes();
		const answer = await rigs.start(
			post({
				group: "fixture",
				rig: "echo",
				tree: "main",
				values: { mode: "c" },
			}),
		);
		expect(answer.status).toBe(400);
	});

	it("saves a preset by name and drops it", async () => {
		const rigs = routes();
		const preset = { group: "fixture", rig: "echo", name: "Loud" };
		expect(
			await (
				await rigs.presets(post({ ...preset, values: { loud: true } }, "PUT"))
			).json(),
		).toEqual({ "fixture/echo": { Loud: { loud: true } } });
		expect(await (await rigs.presets(post(preset, "DELETE"))).json()).toEqual({
			"fixture/echo": {},
		});
		expect((await rigs.presets(post(preset, "PUT"))).status).toBe(400);
	});
});
