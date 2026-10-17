import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Conversation } from "./conversation";
import { eventually } from "./conversation-testing";
import { Conversations } from "./conversations";
import { CoordinatorState } from "./coordinator-state";
import { type DevServer, dev } from "./dev";
import { atWork, json } from "./dev-testing";
import { DevWorkers, LOCAL_WORKER } from "./dev-workers";
import { AGENT, FakeAgent } from "./fake-agent";
import { FakeAgentPs } from "./fake-agent-ps";
import { RESTART } from "./supervise";
import { Testing } from "./testing";
import { UnixWorkerSocket } from "./unix-worker-socket";
import { WorkerDaemon } from "./worker-daemon";

describe("dev restart with agents on the worker", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let daemon: WorkerDaemon;
	let workers: DevWorkers;
	let opened: Map<string, Conversations>;
	let exits: number[];
	let server: DevServer;
	let socket: string;
	/** The conversation started before each, idle on the worker. */
	let id: string;
	let before: Conversation;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		opened = new Map();
		exits = [];
		socket = join(deps.arborHome, "worker.sock");
		daemon = new WorkerDaemon(
			{ where: socket, dial: () => UnixWorkerSocket.connect(socket) },
			{
				id: LOCAL_WORKER,
				slots: 4,
				ps: new FakeAgentPs(agent),
				fs: deps.fs,
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void daemon.run();
		server = await run();
		const started = await json(
			server.port,
			"/api/conversations?project=repo",
			"POST",
			{ agent: "fake" },
		);
		id = (await started.json()).id;
		before = await converse(deps).find(id);
		await eventually(() => before.state.status === "idle", 5);
	});

	afterEach(async () => {
		await server.disposeAsync();
		await daemon.disposeAsync();
		await deps.disposeAsync();
	});

	/** Starts `arbor dev` as the next run of the one coordinator, over the logs as they are. */
	async function run(): Promise<DevServer> {
		opened.clear();
		const coordinator = await CoordinatorState.open(
			join(deps.arborHome, "coordinator.json"),
			deps.fs,
		);
		workers = new DevWorkers(deps.log, { session: coordinator.session });
		return dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
			coordinator,
			workers,
			workerSocket: socket,
			exit: (code) => exits.push(code),
		});
	}

	/** The conversations of the project kept in `arborDir`, run on the worker. */
	function converse({ arborDir }: { arborDir: string }): Conversations {
		const found =
			opened.get(arborDir) ??
			new Conversations(`${arborDir}/conversations`, [AGENT], {
				launcher: workers.local,
				machine: workers.local,
			});
		opened.set(arborDir, found);
		return found;
	}

	/** What `coordinator.json` says the next run takes back. */
	async function kept(): Promise<{ roots: string[] }> {
		return JSON.parse(
			await deps.fs.read(join(deps.arborHome, "coordinator.json")),
		) as { roots: string[] };
	}

	it("restarts at once around an agent at work, which the next run finds still on its turn", async () => {
		await atWork(agent, before);
		// Over the socket, the prompt reaches the agent a moment after the page
		// sees the turn running.
		await eventually(() => agent.prompts.length === 1, 5);
		const { cancelled } = agent;

		const response = await json(server.port, "/api/power", "POST", {
			shutdown: false,
		});

		expect(response.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([RESTART]);
		expect((await kept()).roots).toEqual([deps.root]);
		expect(agent.killed).toBe(0);
		await server.disposeAsync();

		server = await run();
		const after = await converse(deps).find(id);
		expect(after.state.status).toBe("running");
		await after.cancel();
		// The cancel crosses the worker socket to the agent, which can take longer
		// than the other waits when the machine is busy; this one ends when it lands.
		await eventually(() => after.state.status === "idle", 50);

		expect(after.state.status).toBe("idle");
		expect(agent.cancelled).toBe(cancelled + 1);
		expect(agent.launched).toHaveLength(1);
		expect(agent.killed).toBe(0);
		await after.prompt("more");
		await eventually(() => after.state.status === "idle", 5);
		expect(agent.prompts).toHaveLength(2);
	});

	it("lists an agent at work on the worker as one a restart keeps, and restarts at once around it", async () => {
		await atWork(agent, before);
		await eventually(() => agent.prompts.length === 1, 5);

		const listed = (await (
			await fetch(`http://127.0.0.1:${server.port}/api/projects`)
		).json()) as { projects: { conversations: unknown[] }[] };
		const restarted = await json(server.port, "/api/restart", "POST");

		expect(listed.projects.flatMap((each) => each.conversations)).toEqual([
			{ id, name: "fake", status: "running", checkpoint: null, survives: true },
		]);
		expect(restarted.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([RESTART]);
		expect(agent.killed).toBe(0);
	});

	it("takes nothing back after a shutdown, which stops each agent as before", async () => {
		await json(server.port, "/api/power", "POST", { shutdown: true });

		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([0]);
		await server.disposeAsync();
		expect((await kept()).roots).toEqual([]);
		await eventually(() => agent.killed === 1, 5);
	});
});
