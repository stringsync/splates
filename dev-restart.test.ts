import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { eventually } from "./conversation-testing";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { atWork, json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";
import { RESTART } from "./supervise";
import { Testing } from "./testing";

describe("dev restart", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{
				launch: agent.launch,
			},
		);
	});

	afterEach(() => deps.disposeAsync());

	it("shuts down once every live one has checkpointed, the next start telling each to carry on", async () => {
		const said: string[] = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit,
		});
		const started = await json(server.port, "/api/conversations", "POST", {
			agent: "fake",
		});
		const { id } = (await started.json()) as { id: string };
		const conversation = await conversations.find(id);
		await eventually(() => conversation.state.status === "idle", 5);
		await atWork(agent, conversation);

		const response = await json(server.port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "shutdown",
		});

		expect(response.status).toBe(200);
		expect(await exited).toBe(0);
		expect(said).toEqual([CHECKPOINT]);

		const again = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () =>
				new Conversations(`${deps.arborDir}/conversations`, [AGENT], {
					launch: agent.launch,
				}),
		});
		try {
			await eventually(() => said.length >= 2, 5);
			expect(said).toEqual([CHECKPOINT, RESUME]);
		} finally {
			await again.disposeAsync();
		}
	});

	it("refuses to shut down where arbor dev cannot exit itself", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const response = await json(server.port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "shutdown",
			});

			expect(response.status).toBe(400);
			expect(await response.text()).toContain("cannot shut itself down");
		} finally {
			await server.disposeAsync();
		}
	});

	it("says a restart that resumes is to follow the checkpoint, then opens each other project it stopped agents in at once, for each to carry on", async () => {
		await using other = await Testing.open();
		await deps.projects.register(deps.root);
		await deps.projects.register(other.root);
		const said: string[] = [];
		let answer = () => {};
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		agent.turn = async (_, __, text) => {
			said.push(text);
			await answered;
			return "end_turn";
		};
		const opened = new Map<string, Conversations>();
		const converse = ({ arborDir }: { arborDir: string }) => {
			const found =
				opened.get(arborDir) ??
				new Conversations(`${arborDir}/conversations`, [AGENT], {
					launch: agent.launch,
				});
			opened.set(arborDir, found);
			return found;
		};
		const exits: number[] = [];
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
			exit: (code) => exits.push(code),
		});
		const listed = async (port: number) =>
			(await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json()) as {
				restarting: { resume: boolean; shutdown: boolean } | null;
				restarted: string | null;
				run: string;
			};
		let run = "";
		try {
			const { port } = server;
			const started = await json(
				port,
				"/api/conversations?project=repo-2",
				"POST",
				{ agent: "fake" },
			);
			const { id } = (await started.json()) as { id: string };
			const conversation = await converse(other).find(id);
			await eventually(() => conversation.state.status === "idle", 5);
			await atWork(agent, conversation);
			expect((await listed(port)).restarting).toBeNull();

			await json(port, "/api/checkpoint", "POST", {
				projects: ["repo-2"],
				after: "resume",
			});

			({ run } = await listed(port));
			expect((await listed(port)).restarting).toEqual({
				resume: true,
				shutdown: false,
			});
			answer();
			await eventually(() => exits.length !== 0, 5);
			expect(exits).toEqual([RESTART]);
		} finally {
			await server.disposeAsync();
		}

		opened.clear();
		const restarted = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
		});
		try {
			await eventually(() => said.length >= 2, 5);
			expect(said).toEqual([CHECKPOINT, RESUME]);
			const again = await listed(restarted.port);
			expect(again.run).not.toBe(run);
			expect(again.restarting).toBeNull();
			await eventually(
				async () => (await listed(restarted.port)).restarted === null,
				5,
			);
			expect((await listed(restarted.port)).restarted).toBeNull();
		} finally {
			await restarted.disposeAsync();
		}
	});

	it("restarts or shuts down at once with no checkpoint, though an agent is at work, and reopens nothing after", async () => {
		const said: string[] = [];
		agent.turn = (_, __, text) => {
			said.push(text);
			return new Promise(() => {});
		};
		const exits: number[] = [];
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit: (code) => exits.push(code),
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
			});
			const { id } = (await started.json()) as { id: string };
			const conversation = await conversations.find(id);
			await eventually(() => conversation.state.status === "idle", 5);
			void conversation.prompt("work");
			await eventually(() => conversation.state.status === "running", 5);

			const restarted = await json(port, "/api/power", "POST", {
				shutdown: false,
			});

			expect(restarted.status).toBe(200);
			await eventually(() => exits.length !== 0, 5);
			expect(exits).toEqual([RESTART]);
			expect(said).toEqual(["work"]);
		} finally {
			await server.disposeAsync();
		}

		const again = await dev(deps, {
			ports: OpenPortProvider.any(),
			exit: (code) => exits.push(code),
		});
		try {
			const listed = (await (
				await fetch(`http://127.0.0.1:${again.port}/api/projects`)
			).json()) as { restarted: string | null };
			expect(listed.restarted).toBeNull();

			const shut = await json(again.port, "/api/power", "POST", {
				shutdown: true,
			});

			expect(shut.status).toBe(200);
			await eventually(() => exits.length === 2, 5);
			expect(exits).toEqual([RESTART, 0]);
		} finally {
			await again.disposeAsync();
		}
	});

	it("restarts at once with every agent idle, refused while one is at work, and reopens nothing after", async () => {
		let finish = () => {};
		agent.turn = () =>
			new Promise((resolve) => {
				finish = () => resolve("end_turn");
			});
		const exits: number[] = [];
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit: (code) => exits.push(code),
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
			});
			const { id } = (await started.json()) as { id: string };
			const conversation = await conversations.find(id);
			await eventually(() => conversation.state.status === "idle", 5);
			void conversation.prompt("work");
			await eventually(() => conversation.state.status === "running", 5);

			const refused = await json(port, "/api/restart", "POST");

			expect(refused.status).toBe(400);
			expect(await refused.json()).toMatchObject({ reason: "usage" });

			finish();
			await eventually(() => conversation.state.status === "idle", 5);

			const restarted = await json(port, "/api/restart", "POST");

			expect(restarted.status).toBe(200);
			await eventually(() => exits.length !== 0, 5);
			expect(exits).toEqual([RESTART]);
		} finally {
			await server.disposeAsync();
		}

		const again = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const listed = (await (
				await fetch(`http://127.0.0.1:${again.port}/api/projects`)
			).json()) as { restarted: string | null };
			expect(listed.restarted).toBeNull();
		} finally {
			await again.disposeAsync();
		}
	});

	it.skipIf(process.platform === "win32")(
		"refuses to restart while an idle agent's command still runs, and lists it",
		async () => {
			// The agent is this process, so what it starts runs under it.
			agent.pid = process.pid;
			const exits: number[] = [];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
				exit: (code) => exits.push(code),
			});
			// In a session of its own, as an agent runs each command.
			const command = Bun.spawn(["sh", "-c", "sleep 30; true"], {
				detached: true,
			});
			try {
				const { port } = server;
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				await eventually(() => conversation.state.status === "idle", 5);

				const held = async () =>
					(
						(await (
							await fetch(`http://127.0.0.1:${port}/api/projects`)
						).json()) as { held: { where: string; command: string }[] }
					).held;
				// Until the shell has started the command it runs.
				await eventually(
					async () => (await held())[0]?.command === "sleep 30",
					5,
				);
				const listed = await held();
				const refused = await json(port, "/api/restart", "POST");

				expect(listed).toEqual([{ where: "fake", command: "sleep 30" }]);
				expect(refused.status).toBe(400);
				expect(exits).toEqual([]);

				command.kill();
				await command.exited;
				const restarted = await json(port, "/api/restart", "POST");

				expect(restarted.status).toBe(200);
				await eventually(() => exits.length !== 0, 5);
				expect(exits).toEqual([RESTART]);
			} finally {
				command.kill();
				await server.disposeAsync();
			}
		},
	);

	it("forgets the checkpoint of an agent that fails to come back, leaving it failed", async () => {
		const said: string[] = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		const exits: number[] = [];
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit: (code) => exits.push(code),
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
			});
			const { id } = (await started.json()) as { id: string };
			const conversation = await conversations.find(id);
			await eventually(() => conversation.state.status === "idle", 5);
			await atWork(agent, conversation);

			await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "resume",
			});

			await eventually(() => exits.length !== 0, 5);
			expect(exits).toEqual([RESTART]);
		} finally {
			await server.disposeAsync();
		}

		agent.dying = 1;
		const again = new Conversations(`${deps.arborDir}/conversations`, [AGENT], {
			launch: agent.launch,
		});
		const restarted = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => again,
		});
		const listed = async () =>
			(await (
				await fetch(`http://127.0.0.1:${restarted.port}/api/projects`)
			).json()) as { restarted: string | null };
		try {
			const [conversation] = await again.list();
			await eventually(async () => (await listed()).restarted === null, 5);
			expect(conversation?.state).toMatchObject({
				status: "failed",
				checkpoint: null,
			});
			expect(said).toEqual([CHECKPOINT]);
		} finally {
			await restarted.disposeAsync();
		}
	});
});
