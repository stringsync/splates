import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeAgent } from "../agents/testing";
import type { Conversation } from "../conversations";
import { Conversations } from "../conversations";
import { eventually, until } from "../conversations/testing";
import { CHECKPOINT, RESUME } from "../plans";
import type { Storage } from "../storage";
import { Testing } from "../testing";
import { type DevServer, dev } from "./server";
import { RESTART, UPDATE } from "./supervise";
import { atWork, json } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("dev restart", () => {
	let deps: Testing;
	let agent: FakeAgent;
	// Each project's conversations, by its splates dir, as the server opens them.
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

	/** The conversations of the project kept in `dir`, made once. */
	function converse({
		dir,
		storage,
	}: {
		dir: string;
		storage: Storage;
	}): Conversations {
		const found =
			opened.get(dir) ??
			new Conversations(`${dir}/conversations`, [AGENT], {
				storage: storage.within("conversations"),
				launch: agent.launch,
			});
		opened.set(dir, found);
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

	/** Starts `splates server` again on the conversations' logs, read afresh. */
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

	it("shuts down anyway once the deadline passes on an agent that never answers its checkpoint", async () => {
		await server.disposeAsync();
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
			exit: (code) => exits.push(code),
			deadlineMs: 200,
		});
		agent.turn = () => new Promise(() => {});
		await atWork(agent, await start());

		await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "shutdown",
		});

		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([0]);
	});

	it("restarts onto the newest splates when the checkpoint asks to update, as `splates update` does", async () => {
		const response = await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "resume",
			update: true,
		});

		expect(response.status).toBe(200);
		await eventually(() => exits.length !== 0, 5);
		expect(exits).toEqual([UPDATE]);
	});

	it("refuses to shut down where splates server cannot exit itself", async () => {
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
		await using other = await Testing.open({ alongside: deps });
		await deps.projects.forget(other.root);
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
		const received = Promise.withResolvers<void>();
		agent.turn = (_, __, text) => {
			said.push(text);
			received.resolve();
			return new Promise(() => {});
		};
		const conversation = await start();
		await conversation.prompt("work");
		// Running is recorded before the prompt reaches the agent.
		await received.promise;

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
		const received = Promise.withResolvers<void>();
		const finished = Promise.withResolvers<"end_turn">();
		agent.turn = () => {
			received.resolve();
			return finished.promise;
		};
		const conversation = await start();
		await conversation.prompt("work");
		await received.promise;

		const refused = await json(server.port, "/api/restart", "POST");

		expect(refused.status).toBe(400);
		expect(await refused.json()).toMatchObject({ reason: "usage" });

		finished.resolve("end_turn");
		await until(conversation, "idle");

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
		await deps.fs.rm(`${deps.splatesHome}/restart.json`, { force: true });
		server = await again();
		const [conversation] = await converse(deps).list();
		expect(conversation?.state.checkpoint).toBe("done");

		const { projects } = await listed(server.port);

		expect(projects.flatMap((each) => each.conversations)).toEqual([]);
		expect(conversation?.state.checkpoint).toBeNull();
	});
});
