import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { chmod } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type DevServer, dev } from "@stringsync/splates-server";
import { printed } from "@stringsync/splates-server/agents/testing";
import { relayFile } from "@stringsync/splates-server/records";
import { Testing } from "@stringsync/splates-server/testing";
import type { RemoteWorker } from "@stringsync/splates-server/workers";
import {
	DevWorkers,
	UnixWorkerSocket,
	WORKER_KEY,
	WorkerDaemon,
	workerCreds,
} from "@stringsync/splates-server/workers";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { color, MemoryLogger } from "webappwiz/log";
import { NodePs, OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";

const CLI = join(import.meta.dirname, "index.ts");

// Real git, a real coordinator and worker, and a fresh CLI process per
// command, as in the e2e tests.
setDefaultTimeout(90_000);

describe("WorkerRelay", () => {
	let env: Testing;
	let server: DevServer;
	let workers: DevWorkers;
	let daemon: WorkerDaemon;
	/** The worker, as the coordinator holds it. */
	let worker: RemoteWorker;
	/** A worker on another machine: a home of its own, and a clone with no `.git/splates`. */
	let home: string;
	let clone: string;
	let bin: string;
	let relay: string;

	beforeEach(async () => {
		env = await Testing.open();
		await env.commit(
			env.root,
			"splates.config.ts",
			`export default { preMerge: "true", remote: "origin" };\n`,
			"config",
		);
		env.config.remote = "origin";
		const base = dirname(env.root);
		// The central remote, which only the coordinator moves trunk on.
		const remote = join(base, "remote.git");
		await env.gitCli(base, "init", "--quiet", "--bare", "-b", "main", remote);
		await env.gitCli(env.root, "remote", "add", "origin", remote);
		await env.gitCli(env.root, "push", "--quiet", "origin", "main");
		const socket = join(base, "worker.sock");
		const log = new MemoryLogger();
		workers = new DevWorkers(log);
		server = await dev(env, {
			ports: OpenPortProvider.any(),
			workers,
			workerSocket: socket,
		});
		home = join(base, "worker", "home");
		clone = join(base, "worker", "repo");
		await env.gitCli(base, "clone", "--quiet", remote, clone);
		await env.gitCli(clone, "config", "user.email", "splates@example.com");
		await env.gitCli(clone, "config", "user.name", "splates");
		await env.gitCli(clone, "config", "commit.gpgsign", "false");
		// `splates add` runs no install of its own here.
		bin = join(base, "worker", "bin");
		await env.fs.mkdir(bin);
		await env.fs.write(join(bin, "bunx"), "#!/bin/sh\nexit 0\n");
		await chmod(join(bin, "bunx"), 0o755);
		const joined = new Promise<RemoteWorker>((resolve) =>
			workers.registry.events.on(
				"joined",
				(each) => each.id === "remote" && resolve(each),
			),
		);
		daemon = new WorkerDaemon(
			{ where: socket, dial: () => UnixWorkerSocket.connect(socket) },
			{
				id: "remote",
				slots: 2,
				ps: new NodePs(),
				fs: env.fs,
				log,
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				relayAt: relayFile(home),
			},
		);
		void daemon.run();
		worker = await joined;
		relay = JSON.parse(await env.fs.read(relayFile(home))).url;
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		await server.disposeAsync();
		await env.disposeAsync();
	});

	/** Runs the CLI in `cwd` on the worker, as an agent there would with `agentEnv`. */
	const splates = async (
		cwd: string,
		args: string[],
		agentEnv: Record<string, string> = {
			SPLATES_DEV: relay,
			SPLATES_PROJECT: basename(env.root),
		},
	): Promise<string> => {
		const { exitCode, stdout, stderr } = await env.ps.spawnCapture(
			["bun", CLI, ...args],
			{
				cwd,
				env: {
					PATH: `${bin}:${process.env.PATH}`,
					SPLATES_HOME: home,
					...agentEnv,
				},
			},
		);
		if (exitCode !== 0) {
			throw new Error(`splates ${args.join(" ")}: ${stderr}`);
		}
		return color.strip(stdout);
	};

	/** What an agent the worker starts finds as `SPLATES_DEV`, told the coordinator's own. */
	const agentDev = (): Promise<string> =>
		printed(
			worker.start(["sh", "-c", 'printf "$SPLATES_DEV"'], clone, {
				SPLATES_DEV: "http://127.0.0.1:1",
			}),
		);

	it("points an agent the worker starts at the relay", async () => {
		expect(await agentDev()).toBe(relay);
	});

	it("finds the relay and the project by hand, with no env", async () => {
		await splates(clone, ["todo", "add", "make it so", "the detail"], {});

		expect(await env.todos.all()).toMatchObject([{ subject: "make it so" }]);
	});

	it("joins with the token `worker add` mints, over the coordinator's own routes", async () => {
		const coordinator = `http://127.0.0.1:${server.port}`;
		const added = await env.ps.spawnCapture(["bun", CLI, "worker", "add"], {
			cwd: env.root,
			env: { SPLATES_DEV: coordinator },
		});
		const token = /splj_\S+/.exec(color.strip(added.stdout + added.stderr));
		expect(token).not.toBeNull();

		const store = new FakeSecretStore();
		const { key } = await workerCreds("box", {
			coordinator,
			slots: 1,
			id: "box",
			join: token?.[0],
			log: new MemoryLogger(),
			ps: new NodePs(),
			fs: env.fs,
			store,
		});

		expect(await store.get(WORKER_KEY)).toBe(key);
		expect(workers.records.verify("box", key)).toBe(true);
	});

	it("takes a task from add to merge on the coordinator's records", async () => {
		await env.todos.add("make it so", null);
		relay = await agentDev();
		await splates(clone, ["lane", "add", "first"]);
		await splates(clone, ["add", "alpha", "--goal", "land it", "--todo", "1"]);
		const tree = (await splates(clone, ["path", "alpha"])).trim();

		expect(await env.fs.exists(join(clone, ".git", "splates"))).toBe(false);
		expect((await env.service.find("alpha")).state).toMatchObject({
			status: "working",
			worktree: tree,
		});
		expect(await env.todos.find(1)).toMatchObject({ takenBy: "alpha" });

		await splates(tree, ["claim", "alpha"]);
		await env.fs.write(join(clone, "..", "shot.png"), "png");
		await splates(tree, ["attach", join(clone, "..", "shot.png")]);
		expect(await splates(clone, ["show", "alpha"])).toContain("alpha");
		expect(await splates(clone, ["list"])).toContain("alpha");
		expect(await splates(clone, ["todo", "list"])).toContain("make it so");
		await splates(tree, ["escalate", "a question"]);
		expect((await env.service.find("alpha")).status).toBe("escalated");
		await splates(tree, ["claim", "alpha"]);

		await env.commit(tree, "work.txt", "done\n", "Do the work");
		await env.finish(tree);
		await splates(tree, ["merge"]);

		// Landed by the coordinator, on the remote and in its own checkout.
		const remote = join(dirname(env.root), "remote.git");
		expect(await env.gitCli(remote, "log", "-1", "--format=%s", "main")).toBe(
			"Do the work",
		);
		expect(await env.gitCli(env.root, "log", "-1", "--format=%s")).toBe(
			"Do the work",
		);
		expect((await env.service.find("alpha")).status).toBe("removed");
		expect(await env.todos.all()).toEqual([]);
	});
});
