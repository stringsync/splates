import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs, OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { eventually } from "../conversations/testing";
import { type DevServer, dev } from "../server";
import { RESTART } from "../server/shared";
import { json } from "../server/testing";
import { FsStorage } from "../storage";
import { Testing } from "../testing";
import { CoordinatorState, DevWorkers, WorkerDaemon } from "../workers";
import { WorkerSocketPair } from "../workers/testing";
import { terminal } from "./testing";

describe("dev terminal kept by its key", () => {
	let deps: Testing;
	let exits: number[];
	/** The run up now, which the worker dials; none between runs. */
	let workers: DevWorkers | null;
	let daemon: WorkerDaemon;
	let server: DevServer;
	/** The page's first socket to the shell, and the shell's pid as it printed it. */
	let first: Awaited<ReturnType<typeof terminal>>;
	let pid: string | undefined;

	beforeEach(async () => {
		deps = await Testing.open();
		exits = [];
		workers = null;
		daemon = new WorkerDaemon(
			{ where: "memory", dial },
			{
				id: "local",
				slots: 4,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void daemon.run();
		server = await run();
		first = await terminal(server.port, "?terminal=tab-1/c1");
		// The quotes keep the command the terminal echoes from reading as its output.
		first.socket.send(new TextEncoder().encode('echo pid"":$$\n'));
		await first.shows("pid:");
		pid = /pid:(\d+)/.exec(first.said.screen)?.[1];
	});

	afterEach(async () => {
		await server.disposeAsync();
		await daemon.disposeAsync();
		await deps.disposeAsync();
	});

	/** A link to the run up now; between runs, the worker tries again. */
	const dial = async () => {
		if (workers === null) {
			throw new Error("splates server is down");
		}
		const pair = new WorkerSocketPair();
		void workers.registry.accept(pair.coordinator, "local");
		return pair.worker;
	};

	/** Starts `splates server` as the next run of the one coordinator. */
	const run = async () => {
		const coordinator = await CoordinatorState.open(
			new FsStorage(deps.splatesHome, deps.fs).document("coordinator.json"),
		);
		workers = new DevWorkers(deps.log, { session: coordinator.session });
		return dev(deps, {
			ports: OpenPortProvider.any(),
			shell: ["/bin/sh"],
			workers,
			coordinator,
			exit: (code) => exits.push(code),
		});
	};

	it("keeps the shell once its socket goes, and redraws it for the page that comes back", async () => {
		first.socket.close();

		const back = await terminal(server.port, "?terminal=tab-1/c1");

		// The screen so far, then the shell as it goes on.
		await back.shows(`pid:${pid}`);
		back.socket.send(new TextEncoder().encode("echo again:$$\n"));
		await back.shows(`again:${pid}`);
	});

	it("ends the shell at once when the page says it is closing it, and starts another under its key", async () => {
		first.socket.send(JSON.stringify({ type: "close" }));
		await first.closes();

		const next = await terminal(server.port, "?terminal=tab-1/c1");
		next.socket.send(new TextEncoder().encode('echo pid"":$$\n'));

		await next.shows("pid:");
		expect(next.said.screen).not.toContain(`pid:${pid}`);
	});

	it("hands the shell to the next run of splates server, which takes it back for its page", async () => {
		await json(server.port, "/api/power", "POST", { shutdown: false });
		await eventually(() => exits.length !== 0, 5);
		workers = null;
		await server.disposeAsync();

		server = await run();
		const back = await terminal(server.port, "?terminal=tab-1/c1");

		expect(exits).toEqual([RESTART]);
		await back.shows(`pid:${pid}`);
		back.socket.send(new TextEncoder().encode("echo again:$$\n"));
		await back.shows(`again:${pid}`);
	});
});
