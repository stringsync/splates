import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodePs } from "core/system";
import {
	type AgentProcess,
	type Launcher,
	launch,
	launcherOf,
} from "../agents/process";
import { MemoryStorage } from "../storage/testing";
import { RigCommands } from "./commands";
import type { RunTree, RunView } from "./run";
import { type KeptRun, RigRuns } from "./runs";

const fixture = `bun ${join(import.meta.dir, "fixtures/rig.ts")}`;

async function until<T>(
	read: () => T | undefined,
	what: string,
	ms = 10_000,
): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const value = read();
		if (value !== undefined) {
			return value;
		}
		if (Date.now() > end) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await Bun.sleep(25);
	}
}

describe("RigRuns", () => {
	let runs: RigRuns | null = null;
	let dirs: string[] = [];

	afterEach(async () => {
		runs?.dispose();
		runs = null;
		await Promise.all(
			dirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		dirs = [];
	});

	async function runner(trees: RunTree[] = []): Promise<{
		runs: RigRuns;
		trees: RunTree[];
	}> {
		const main = await mkdtemp(join(tmpdir(), "rig-main-"));
		dirs.push(main);
		const all = [{ name: "main", path: main }, ...trees];
		const ps = new NodePs();
		runs = new RigRuns({
			listing: () => new RigCommands([fixture], ps, import.meta.dir).list(),
			trees: async () => all,
			launcher: launcherOf(launch),
			kept: new MemoryStorage().document<KeptRun[]>("rig-runs.json"),
			ps,
			base: "ports.example",
			every: { starting: 50, running: 100 },
		});
		return { runs, trees: all };
	}

	const of = (runs: RigRuns, id: string): RunView | undefined =>
		runs.list().find((each) => each.id === id);

	it("starts a rig on its port with its options, and turns healthy once it answers", async () => {
		const { runs } = await runner();
		const started = await runs.start({
			group: "fixture",
			rig: "echo",
			tree: "main",
			values: { loud: true },
		});
		expect(started.id).toBe("fixture/echo@main");
		expect(started.state).toBe("starting");
		expect(started.exposure).toBe("tunnel");
		expect(started.slot).toEqual({ word: "cat", emoji: "😸" });
		const port = started.ports[0]?.port as number;
		expect(started.ports[0]).toEqual({
			name: "web",
			port,
			local: `http://127.0.0.1:${port}`,
			remote: "https://cat.ports.example",
		});
		expect(runs.proxyTargets()).toEqual({
			routes: [{ label: "cat", port, run: "fixture/echo@main" }],
			excluded: new Set(),
		});
		await until(
			() => (of(runs, started.id)?.state === "healthy" ? true : undefined),
			"healthy",
		);
		expect(of(runs, started.id)?.health).toBe("GET /healthz → 200");
		const answer = await fetch(`http://127.0.0.1:${port}/`);
		expect(await answer.text()).toBe(
			"echo --greeting=hello --loud=true --mode=a",
		);
		const log = runs.log(started.id);
		expect(log?.lines[0]?.text).toBe(
			`listening on ${port} with --greeting=hello --loud=true --mode=a`,
		);
		expect(runs.log(started.id, log?.last)?.lines).toEqual([]);
	});

	it("refuses a second run of a rig on one tree, and a value of the wrong type", async () => {
		const { runs } = await runner();
		await runs.start({ group: "fixture", rig: "echo", tree: "main" });
		expect(
			runs.start({ group: "fixture", rig: "echo", tree: "main" }),
		).rejects.toThrow("Echo server already runs on main");
		expect(
			runs.start({
				group: "fixture",
				rig: "echo",
				tree: "nowhere",
			}),
		).rejects.toThrow('no tree "nowhere"');
	});

	it("keeps an exited run with its code and last words until it is dismissed", async () => {
		const { runs } = await runner();
		const started = await runs.start({
			group: "fixture",
			rig: "fail",
			tree: "main",
		});
		const exited = await until(
			() =>
				of(runs, started.id)?.state === "exited"
					? of(runs, started.id)
					: undefined,
			"exit",
		);
		expect(exited.exitCode).toBe(3);
		expect(exited.lastLine).toBe("fail: nothing to serve");
		expect(runs.stop(started.id)).toBe(true);
		expect(runs.list()).toEqual([]);
	});

	it("stops a run, which then leaves the list and frees its port", async () => {
		const { runs } = await runner();
		const started = await runs.start({
			group: "fixture",
			rig: "echo",
			tree: "main",
		});
		await until(
			() => (of(runs, started.id)?.state === "healthy" ? true : undefined),
			"healthy",
		);
		runs.stop(started.id);
		await until(() => (runs.list().length === 0 ? true : undefined), "stopped");
		expect(
			fetch(`http://127.0.0.1:${started.ports[0]?.port}/`),
		).rejects.toThrow();
	});

	it("lets go of a run for a restart, and a runner started again takes it back", async () => {
		const main = await mkdtemp(join(tmpdir(), "rig-main-"));
		dirs.push(main);
		const ps = new NodePs();
		const kept = new MemoryStorage().document<KeptRun[]>("rig-runs.json");
		const worker = fakeWorker();
		const made = () =>
			new RigRuns({
				listing: () => new RigCommands([fixture], ps, import.meta.dir).list(),
				trees: async () => [{ name: "main", path: main }],
				launcher: worker,
				kept,
				ps,
				base: null,
				every: { starting: 50, running: 100 },
			});
		const first = made();
		const started = await first.start({
			group: "fixture",
			rig: "echo",
			tree: "main",
		});
		expect(await first.detach()).toBe(true);
		expect(first.list()).toEqual([]);
		// The server disposes everything as it exits after handing over.
		first.dispose();
		runs = made();
		await runs.resume();
		const taken = runs.list();
		expect(taken.map((run) => [run.id, run.ports[0]?.port])).toEqual([
			[started.id, started.ports[0]?.port],
		]);
		const restarted = runs;
		await until(
			() => (restarted.list()[0]?.state === "healthy" ? true : undefined),
			"healthy again",
		);
	});

	it("stops a run on a task's worktree once the worktree is gone", async () => {
		const worktree = await mkdtemp(join(tmpdir(), "rig-task-"));
		dirs.push(worktree);
		const { runs, trees } = await runner([
			{ name: "beam-fix", path: worktree },
		]);
		const started = await runs.start({
			group: "fixture",
			rig: "echo",
			tree: "beam-fix",
		});
		expect(runs.owners()).toEqual([
			{ task: "beam-fix", pid: expect.any(Number) },
		]);
		trees.pop();
		await until(() => (runs.list().length === 0 ? true : undefined), "stopped");
		expect(of(runs, started.id)).toBeUndefined();
	});

	it("keeps the same animal slot across restarts of the same rig and tree", async () => {
		const { runs } = await runner();
		const first = await runs.start({
			group: "fixture",
			rig: "echo",
			tree: "main",
		});
		expect(first.slot).toEqual({ word: "cat", emoji: "😸" });
		expect(first.ports[0]?.remote).toBe("https://cat.ports.example");
		runs.stop(first.id);
		await until(() => (runs.list().length === 0 ? true : undefined), "stopped");

		const second = await runs.start({
			group: "fixture",
			rig: "echo",
			tree: "main",
		});
		expect(second.slot).toEqual({ word: "cat", emoji: "😸" });
		expect(second.ports[0]?.remote).toBe("https://cat.ports.example");
	});

	it("never exposes a rig with exposure none through the ports host", async () => {
		const { runs } = await runner();
		const started = await runs.start({
			group: "fixture",
			rig: "local",
			tree: "main",
		});
		const port = started.ports[0]?.port as number;
		expect(started.exposure).toBe("none");
		expect(started.slot).toBeNull();
		expect(started.ports[0]?.remote).toBeNull();
		expect(runs.owners()).toEqual([]);
		expect(runs.proxyTargets()).toEqual({
			routes: [],
			excluded: new Set([port]),
		});
	});

	it("reads splates:url lines from a self-exposed rig and keeps them across restarts", async () => {
		const main = await mkdtemp(join(tmpdir(), "rig-main-"));
		dirs.push(main);
		const ps = new NodePs();
		const kept = new MemoryStorage().document<KeptRun[]>("rig-runs.json");
		const worker = fakeWorker();
		const made = () =>
			new RigRuns({
				listing: () => new RigCommands([fixture], ps, import.meta.dir).list(),
				trees: async () => [{ name: "main", path: main }],
				launcher: worker,
				kept,
				ps,
				base: "ports.example",
				every: { starting: 50, running: 100 },
			});
		const first = made();
		const started = await first.start({
			group: "fixture",
			rig: "self",
			tree: "main",
			values: {
				url: "https://web.custom.test",
				"api-url": "https://api.custom.test",
			},
		});
		expect(started.exposure).toBe("self");
		expect(started.slot).toBeNull();
		expect(first.owners()).toEqual([]);
		expect(first.proxyTargets().routes).toEqual([]);
		expect(first.proxyTargets().excluded.size).toBe(2);

		const reported = await until(() => {
			const view = of(first, started.id);
			return view?.ports[0]?.remote !== null && view?.ports[1]?.remote !== null
				? view
				: undefined;
		}, "reported urls");
		expect(reported.ports.map((port) => [port.name, port.remote])).toEqual([
			["web", "https://web.custom.test"],
			["api", "https://api.custom.test"],
		]);

		expect(await first.detach()).toBe(true);
		first.dispose();
		runs = made();
		await runs.resume();
		const resumed = of(runs, started.id);
		expect(resumed?.ports.map((port) => [port.name, port.remote])).toEqual([
			["web", "https://web.custom.test"],
			["api", "https://api.custom.test"],
		]);
	});
});

/** Stands in for the worker, which keeps each process it starts by its channel through a restart. */
function fakeWorker(): Launcher {
	const held = new Map<number, AgentProcess>();
	const gone = (): never => {
		throw new Error("the worker holds no such channel");
	};
	return {
		launch: (argv, cwd, env) => {
			const process = { ...launch(argv, cwd, env) };
			process.handle = { worker: "local", channel: held.size + 1 };
			held.set(process.handle.channel, process);
			return process;
		},
		resume: (handle) => held.get(handle.channel) ?? gone(),
	};
}
