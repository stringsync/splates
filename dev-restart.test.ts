import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
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

	it("restarts once every live one has checkpointed, each waiting after to be resumed", async () => {
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
			for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
				await Bun.sleep(5);
			}

			const response = await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "restart",
			});

			expect(response.status).toBe(200);
			for (let i = 0; i < 100 && exits.length === 0; i++) {
				await Bun.sleep(5);
			}
			expect(exits).toEqual([RESTART]);
			expect(said).toEqual([CHECKPOINT]);
			expect(conversation.state).toMatchObject({
				status: "stopped",
				checkpoint: "done",
			});
		} finally {
			if (exits.length === 0) {
				await server.disposeAsync();
			}
		}

		const again = new Conversations(`${deps.arborDir}/conversations`, [AGENT], {
			launch: agent.launch,
		});
		const restarted = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => again,
		});
		try {
			await Bun.sleep(50);
			expect(said).toEqual([CHECKPOINT]);
			const listed = (await (
				await fetch(`http://127.0.0.1:${restarted.port}/api/projects`)
			).json()) as { restarted: string | null };
			expect(listed.restarted).toBe("waiting");

			await json(restarted.port, "/api/checkpoint/resume", "POST");

			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(5);
			}
			expect(said).toEqual([CHECKPOINT, RESUME]);
		} finally {
			await restarted.disposeAsync();
		}
	});

	it("shuts down once every live one has checkpointed, the next start finding each waiting to be resumed", async () => {
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
		for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
			await Bun.sleep(5);
		}

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
			const listed = (await (
				await fetch(`http://127.0.0.1:${again.port}/api/projects`)
			).json()) as { restarted: string | null };
			expect(listed.restarted).toBe("waiting");
			expect(said).toEqual([CHECKPOINT]);
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
			if (text === CHECKPOINT) {
				await answered;
			}
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
			for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
				await Bun.sleep(5);
			}
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
			for (let i = 0; i < 100 && exits.length === 0; i++) {
				await Bun.sleep(5);
			}
			expect(exits).toEqual([RESTART]);
		} finally {
			if (exits.length === 0) {
				await server.disposeAsync();
			}
		}

		opened.clear();
		const restarted = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: converse,
		});
		try {
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(5);
			}
			expect(said).toEqual([CHECKPOINT, RESUME]);
			const again = await listed(restarted.port);
			expect(again.run).not.toBe(run);
			expect(again.restarting).toBeNull();
			for (
				let i = 0;
				i < 100 && (await listed(restarted.port)).restarted !== null;
				i++
			) {
				await Bun.sleep(5);
			}
			expect((await listed(restarted.port)).restarted).toBeNull();
		} finally {
			await restarted.disposeAsync();
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
			for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
				await Bun.sleep(5);
			}
			void conversation.prompt("work");
			for (let i = 0; i < 100 && conversation.state.status !== "running"; i++) {
				await Bun.sleep(5);
			}

			const refused = await json(port, "/api/restart", "POST");

			expect(refused.status).toBe(400);
			expect(await refused.json()).toMatchObject({ reason: "usage" });

			finish();
			for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
				await Bun.sleep(5);
			}

			const restarted = await json(port, "/api/restart", "POST");

			expect(restarted.status).toBe(200);
			for (let i = 0; i < 100 && exits.length === 0; i++) {
				await Bun.sleep(5);
			}
			expect(exits).toEqual([RESTART]);
		} finally {
			if (exits.length === 0) {
				await server.disposeAsync();
			}
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
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}

				const held = async () =>
					(
						(await (
							await fetch(`http://127.0.0.1:${port}/api/projects`)
						).json()) as { held: { where: string; command: string }[] }
					).held;
				// Until the shell has started the command it runs.
				let listed = await held();
				for (let i = 0; i < 100 && listed[0]?.command !== "sleep 30"; i++) {
					await Bun.sleep(5);
					listed = await held();
				}
				const refused = await json(port, "/api/restart", "POST");

				expect(listed).toEqual([{ where: "fake", command: "sleep 30" }]);
				expect(refused.status).toBe(400);
				expect(exits).toEqual([]);

				command.kill();
				await command.exited;
				const restarted = await json(port, "/api/restart", "POST");

				expect(restarted.status).toBe(200);
				for (let i = 0; i < 100 && exits.length === 0; i++) {
					await Bun.sleep(5);
				}
				expect(exits).toEqual([RESTART]);
			} finally {
				command.kill();
				if (exits.length === 0) {
					await server.disposeAsync();
				}
			}
		},
	);

	it("restarts once a checkpoint has ended, each one done with it waiting after to be resumed", async () => {
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
			for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
				await Bun.sleep(5);
			}
			await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
			for (
				let i = 0;
				i < 100 && conversation.state.checkpoint !== "done";
				i++
			) {
				await Bun.sleep(5);
			}

			const response = await json(port, "/api/checkpoint/restart", "POST");

			expect(response.status).toBe(200);
			for (let i = 0; i < 100 && exits.length === 0; i++) {
				await Bun.sleep(5);
			}
			expect(exits).toEqual([RESTART]);
		} finally {
			if (exits.length === 0) {
				await server.disposeAsync();
			}
		}

		const again = new Conversations(`${deps.arborDir}/conversations`, [AGENT], {
			launch: agent.launch,
		});
		const restarted = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => again,
		});
		try {
			await Bun.sleep(50);
			expect(said).toEqual([CHECKPOINT]);
			const listed = (await (
				await fetch(`http://127.0.0.1:${restarted.port}/api/projects`)
			).json()) as { restarted: string | null };
			expect(listed.restarted).toBe("waiting");

			await json(restarted.port, "/api/checkpoint/resume", "POST");

			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(5);
			}
			expect(said).toEqual([CHECKPOINT, RESUME]);
		} finally {
			await restarted.disposeAsync();
		}
	});
});
