import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import type { Conversation } from "./conversation";
import { eventually } from "./conversation-testing";
import { Conversations } from "./conversations";
import { type DevServer, dev } from "./dev";
import { atWork, json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";
import { RESTART } from "./supervise";
import { Testing } from "./testing";

describe("dev restart", () => {
	let deps: Testing;
	let agent: FakeAgent;
	// Each project's conversations, by its arbor dir, as the server opens them.
	let opened: Map<string, Conversations>;
	let exits: number[];
	let server: DevServer;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		opened = new Map();
		exits = [];
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
			exit: (code) => exits.push(code),
		});
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	/** The conversations of the project kept in `arborDir`, made once. */
	function converse({ arborDir }: { arborDir: string }): Conversations {
		const found =
			opened.get(arborDir) ??
			new Conversations(`${arborDir}/conversations`, [AGENT], {
				launch: agent.launch,
			});
		opened.set(arborDir, found);
		return found;
	}

	/** Starts a conversation in the project `slug`, kept in `where`, idle. */
	async function start(slug = "repo", where = deps): Promise<Conversation> {
		const started = await json(
			server.port,
			`/api/conversations?project=${slug}`,
			"POST",
			{ agent: "fake" },
		);
		const { id } = (await started.json()) as { id: string };
		const conversation = await converse(where).find(id);
		await eventually(() => conversation.state.status === "idle", 5);
		return conversation;
	}

	/** Starts `arbor dev` again on the conversations' logs, read afresh. */
	function again(): Promise<DevServer> {
		opened.clear();
		return dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
			exit: (code) => exits.push(code),
		});
	}

	/** What `port` lists for Power. */
	async function listed(port: number) {
		return (await (
			await fetch(`http://127.0.0.1:${port}/api/projects`)
		).json()) as {
			projects: { conversations: unknown[] }[];
			restarting: { resume: boolean; shutdown: boolean } | null;
			restarted: string | null;
			run: string;
			held: { where: string; command: string }[];
		};
	}

	it("shuts down once every live one has checkpointed, the next start telling each to carry on", async () => {
		const said: string[] = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		await atWork(agent, await start());

		const response = await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "shutdown",
		});

		expect(response.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([0]);
		expect(said).toEqual([CHECKPOINT]);
		await server.disposeAsync();

		server = await again();
		await eventually(() => said.length >= 2, 5);
		expect(said).toEqual([CHECKPOINT, RESUME]);
	});

	it("refuses to shut down where arbor dev cannot exit itself", async () => {
		await server.disposeAsync();
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
		});

		const response = await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "shutdown",
		});

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("cannot shut itself down");
	});

	it("says a restart that resumes is to follow the checkpoint, then opens each other project it stopped agents in at once, for each to carry on", async () => {
		await using other = await Testing.open();
		await deps.projects.register(deps.root);
		await deps.projects.register(other.root);
		const said: string[] = [];
		const { promise: answered, resolve: answer } =
			Promise.withResolvers<void>();
		agent.turn = async (_, __, text) => {
			said.push(text);
			await answered;
			return "end_turn";
		};
		await atWork(agent, await start("repo-2", other));
		expect((await listed(server.port)).restarting).toBeNull();

		await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo-2"],
			after: "resume",
		});

		const { run, restarting } = await listed(server.port);
		expect(restarting).toEqual({ resume: true, shutdown: false });
		answer();
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([RESTART]);
		await server.disposeAsync();

		server = await again();
		await eventually(() => said.length >= 2, 5);
		expect(said).toEqual([CHECKPOINT, RESUME]);
		const back = await listed(server.port);
		expect(back.run).not.toBe(run);
		expect(back.restarting).toBeNull();
		await eventually(
			async () => (await listed(server.port)).restarted === null,
			5,
		);
	});

	it("restarts or shuts down at once with no checkpoint, though an agent is at work, and reopens nothing after", async () => {
		const said: string[] = [];
		agent.turn = (_, __, text) => {
			said.push(text);
			return new Promise(() => {});
		};
		const conversation = await start();
		void conversation.prompt("work");
		await eventually(() => conversation.state.status === "running", 5);

		const restarted = await json(server.port, "/api/power", "POST", {
			shutdown: false,
		});

		expect(restarted.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([RESTART]);
		expect(said).toEqual(["work"]);
		await server.disposeAsync();

		server = await again();
		expect((await listed(server.port)).restarted).toBeNull();

		const shut = await json(server.port, "/api/power", "POST", {
			shutdown: true,
		});

		expect(shut.status).toBe(200);
		await eventually(() => exits.length === 2, 5);
		expect(exits).toEqual([RESTART, 0]);
	});

	it("restarts at once with every agent idle, refused while one is at work, and reopens nothing after", async () => {
		let finish = () => {};
		agent.turn = () =>
			new Promise((resolve) => {
				finish = () => resolve("end_turn");
			});
		const conversation = await start();
		void conversation.prompt("work");
		await eventually(() => conversation.state.status === "running", 5);

		const refused = await json(server.port, "/api/restart", "POST");

		expect(refused.status).toBe(400);
		expect(await refused.json()).toMatchObject({ reason: "usage" });

		finish();
		await eventually(() => conversation.state.status === "idle", 5);

		const restarted = await json(server.port, "/api/restart", "POST");

		expect(restarted.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([RESTART]);
		await server.disposeAsync();

		server = await again();
		expect((await listed(server.port)).restarted).toBeNull();
	});

	it.skipIf(process.platform === "win32")(
		"refuses to restart while an idle agent's command still runs, and lists it",
		async () => {
			// The agent is this process, so what it starts runs under it.
			agent.pid = process.pid;
			// In a session of its own, as an agent runs each command.
			const command = Bun.spawn(["sh", "-c", "sleep 30; true"], {
				detached: true,
			});
			try {
				await start();
				const held = async () => (await listed(server.port)).held;
				// Until the shell has started the command it runs.
				await eventually(
					async () => (await held())[0]?.command === "sleep 30",
					5,
				);

				const holding = await held();
				const refused = await json(server.port, "/api/restart", "POST");

				expect(holding).toEqual([{ where: "fake", command: "sleep 30" }]);
				expect(refused.status).toBe(400);
				expect(exits).toEqual([]);

				command.kill();
				await command.exited;
				const restarted = await json(server.port, "/api/restart", "POST");

				expect(restarted.status).toBe(200);
				await eventually(() => exits.length !== 0, 5);
				expect(exits).toEqual([RESTART]);
			} finally {
				command.kill();
			}
		},
	);

	it("forgets the checkpoint of an agent that fails to come back, leaving it failed", async () => {
		const said: string[] = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		await atWork(agent, await start());
		await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "resume",
		});
		await eventually(() => exits.length !== 0, 5);
		await server.disposeAsync();
		agent.dying = 1;

		server = await again();

		const [conversation] = await converse(deps).list();
		await eventually(
			async () => (await listed(server.port)).restarted === null,
			5,
		);
		expect(conversation?.state).toMatchObject({
			status: "failed",
			checkpoint: null,
		});
		expect(said).toEqual([CHECKPOINT]);
	});

	it("forgets a checkpoint left by a run that stopped without saying to resume, so Power is not held on it", async () => {
		agent.turn = async () => "end_turn";
		await atWork(agent, await start());
		await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "resume",
		});
		await eventually(() => exits.length !== 0, 5);
		await server.disposeAsync();
		// As when killed mid-checkpoint and started again by hand.
		const { path } = deps.projects;
		await deps.fs.rm(`${path.slice(0, path.lastIndexOf("/"))}/restart.json`, {
			force: true,
		});
		server = await again();
		const [conversation] = await converse(deps).list();
		expect(conversation?.state.checkpoint).toBe("done");

		const { projects } = await listed(server.port);

		expect(projects.flatMap((each) => each.conversations)).toEqual([]);
		expect(conversation?.state.checkpoint).toBeNull();
	});
});
