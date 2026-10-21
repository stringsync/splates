import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { WORKER_KEY } from "./creds";
import {
	builtFile,
	restartWorker,
	UPDATE_EXIT,
	updatedBuild,
	updateFile,
	WORKER_KEPT,
} from "./lifecycle";
import type { WorkerRunOptions } from "./run-options";

describe("restartWorker", () => {
	let dir: string;
	let ps: FakePs;
	let store: FakeSecretStore;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-restart-"));
		ps = new FakePs();
		ps.setEnv({ SPLATES_HOME: dir });
		store = new FakeSecretStore();
		await store.set(WORKER_KEY, "the-key");
	});

	afterEach(() => rm(dir, { recursive: true, force: true }));

	const options = (): WorkerRunOptions => ({
		coordinator: "https://splates.example.com",
		slots: 2,
		id: "box",
		log: new MemoryLogger(),
		ps,
		fs: new NodeFs(),
		store,
	});
	const creds = { key: "the-key", access: null };

	it("keeps the worker on each build it is told, ending as the last one does", async () => {
		// The first is told 3.0.0; the second ends.
		const runs = [
			async () => {
				await mkdir(dirname(updateFile(ps, "box")), { recursive: true });
				await writeFile(updateFile(ps, "box"), "3.0.0");
				return UPDATE_EXIT;
			},
			async () => 0,
		];
		ps.simulate(() => (runs.shift() ?? (async () => 1))());

		await restartWorker("2.0.0", "box", creds, options());

		expect(ps.getCalls()).toEqual([
			"bunx @stringsync/splates@2.0.0 worker run --coordinator https://splates.example.com --id box --slots 2",
			"bunx @stringsync/splates@3.0.0 worker run --coordinator https://splates.example.com --id box --slots 2",
		]);
		// The store keeps its key, so none goes in the environment its agents inherit.
		expect(ps.getCallEnvs()[0]).toEqual({ [WORKER_KEPT]: "1" });
		expect(ps.getExitCode()).toBe(0);
	});

	it("hands the key it holds alone to the worker it starts, where the store has none", async () => {
		await store.delete(WORKER_KEY);
		ps.simulate(async () => 0);

		await restartWorker("2.0.0", "box", creds, options());

		expect(ps.getCallEnvs()[0]).toEqual({
			[WORKER_KEPT]: "1",
			[WORKER_KEY]: "the-key",
		});
	});

	it("leaves the build to the worker keeping it, when it is kept already", async () => {
		ps.setEnv({ SPLATES_HOME: dir, [WORKER_KEPT]: "1" });

		await restartWorker("2.0.0", "box", creds, options());

		expect(ps.getCalls()).toEqual([]);
		expect(ps.getExitCode()).toBe(UPDATE_EXIT);
		expect(await Bun.file(updateFile(ps, "box")).text()).toBe("2.0.0");
	});

	it("starts a keeper pinned to an old release on the build it last updated to", async () => {
		ps.simulate(async () => 0);
		await restartWorker("3.0.0", "box", creds, options());
		expect(await Bun.file(builtFile(ps, "box")).text()).toBe("3.0.0");

		const fs = new NodeFs();
		expect(await updatedBuild(ps, fs, "box", "2.0.0")).toBe("3.0.0");
		expect(await updatedBuild(ps, fs, "box", "3.0.0")).toBeNull();
		expect(await updatedBuild(ps, fs, "box", "4.0.0")).toBeNull();
		expect(await updatedBuild(ps, fs, "other", "2.0.0")).toBeNull();
		ps.setEnv({ SPLATES_HOME: dir, [WORKER_KEPT]: "1" });
		expect(await updatedBuild(ps, fs, "box", "2.0.0")).toBeNull();
	});
});
