import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { type ConversationState, Conversations } from "./conversations";
import { dev } from "./dev";
import { readUntil, serving } from "./dev-testing";
import { AGENT, FakeAgent, heard, ROSTERED, say } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";
import { RESTART } from "./supervise";
import { Testing } from "./testing";

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	describe("conversations", () => {
		let agent: FakeAgent;
		let conversations: Conversations;

		beforeEach(() => {
			agent = new FakeAgent();
			conversations = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{
					launch: agent.launch,
				},
			);
		});

		const json = (port: number, path: string, method: string, body = {}) =>
			fetch(`http://127.0.0.1:${port}${path}`, {
				method,
				headers: {
					origin: `http://127.0.0.1:${port}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});

		it("says they are off unless asked for", async () => {
			await serving(deps, async (_, port) => {
				const response = await fetch(
					`http://localhost:${port}/api/conversations`,
				);

				expect(response.status).toBe(404);
				expect(await response.json()).toMatchObject({
					reason: "not_found",
					message: "conversations are off",
				});
			});
		});

		it("assigns a todo and a lane an agent off the roster, and starts a conversation on a model", async () => {
			const rostered = new Conversations(
				`${deps.arborDir}/conversations`,
				[ROSTERED],
				{ launch: agent.launch },
			);
			await deps.todos.add("first", null);
			await deps.todos.addLane("Licensing");
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => rostered,
			});
			try {
				const { port } = server;
				const listed = (await (
					await fetch(`http://localhost:${port}/api/conversations`)
				).json()) as { agents: unknown[] };
				expect(listed.agents).toEqual([
					{
						id: "fake",
						name: "Fake",
						models: [
							{ id: "big", name: "Big" },
							{ id: "small", name: "Small" },
						],
						settings: [],
						limits: [],
					},
				]);

				await json(port, "/api/todos/1/assignee", "PUT", {
					agent: "fake",
					model: "Small",
				});
				await json(port, "/api/lanes/1/assignee", "PUT", { agent: "fake" });
				expect((await deps.todos.find(1)).state.assignee).toEqual({
					agent: "fake",
					model: "small",
				});
				expect(await deps.todos.lanes()).toEqual([
					{ id: 1, name: "Licensing", assignee: { agent: "fake" } },
				]);
				const refused = await json(port, "/api/todos/1/assignee", "PUT", {
					agent: "nobody",
				});
				expect(refused.status).toBe(400);
				await json(port, "/api/todos/1/assignee", "PUT", { agent: null });
				expect((await deps.todos.find(1)).state.assignee).toBeUndefined();

				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
					model: "small",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await rostered.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("starts the agent of a task handed to one, in its tree, once", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const until = async (done: () => boolean) => {
				for (let i = 0; i < 200 && !done(); i++) {
					await Bun.sleep(10);
				}
			};
			await add(deps, "alpha", {
				dispatch: { agent: "fake", model: "Small", prompt: "Do the part." },
				agents: [ROSTERED],
			});
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				await until(() => said.length === 1);
				const alpha = await deps.service.find("alpha");
				const [started] = await conversations.list();

				expect(said).toEqual(["[ARBOR TASK alpha]\n\nDo the part."]);
				expect(agent.launched.map((each) => each.cwd)).toEqual([alpha.path]);
				expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
				expect(started?.state.task).toBe("alpha");
				expect(alpha.state?.dispatch?.conversation).toBe(started?.id);

				// Handed over while the server runs, with no page listening.
				await add(deps, "beta", {
					dispatch: { agent: "fake" },
					agents: [ROSTERED],
				});
				await until(() => said.length === 2);

				expect(said[1]).toBe("[ARBOR TASK beta]");
			} finally {
				await server.disposeAsync();
			}

			// Each is started once, however often the server starts, and one
			// whose tree is still readying waits for it.
			await add(deps, "gamma", {
				dispatch: { agent: "fake" },
				agents: [ROSTERED],
			});
			const gamma = await deps.service.find("gamma");
			await gamma.save({
				dispatch: { ...gamma.state?.dispatch, agent: "fake", pending: true },
			});
			const again = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				await Bun.sleep(200);
				expect(agent.launched).toHaveLength(2);
			} finally {
				await again.disposeAsync();
			}
		});

		it("lists the sessions in a task's tree and brings one in", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;
			agent.held = [
				{
					sessionId: "cli-1",
					cwd: tree,
					title: "From the CLI",
					replay: [heard("hello"), say("Hi.")],
				},
			];
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const listed = await fetch(
					`http://localhost:${port}/api/conversations/sessions?task=alpha`,
				);

				expect(await listed.json()).toEqual([
					{
						agent: "fake",
						session: "cli-1",
						title: "From the CLI",
						updatedAt: null,
					},
				]);

				const brought = await json(
					port,
					"/api/conversations/sessions",
					"POST",
					{
						agent: "fake",
						session: "cli-1",
						task: "alpha",
						title: "From the CLI",
					},
				);
				expect(brought.status).toBe(200);
				const { id } = (await brought.json()) as { id: string };
				const conversation = await conversations.find(id);
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
					await Bun.sleep(5);
				}
				expect(conversation.state).toMatchObject({
					task: "alpha",
					title: "From the CLI",
					messages: [
						{ role: "user", parts: [{ type: "text", text: "hello" }] },
						{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
					],
				});
				expect(agent.launched.at(-1)?.cwd).toBe(tree);
			} finally {
				await server.disposeAsync();
			}
		});

		it("checkpoints the live ones of each project named", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
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

				expect((await json(port, "/api/checkpoint", "POST")).status).toBe(400);
				const response = await json(port, "/api/checkpoint", "POST", {
					projects: ["repo"],
				});

				expect(response.status).toBe(200);
				for (
					let i = 0;
					i < 100 && conversation.state.checkpoint !== "done";
					i++
				) {
					await Bun.sleep(5);
				}
				expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
				await json(port, "/api/conversations/checkpoint", "DELETE");
				expect(conversation.state.checkpoint).toBeNull();
			} finally {
				await server.disposeAsync();
			}
		});

		it("lists each project's live conversations, for its checkpoint", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
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

				const listed = (await (
					await fetch(`http://127.0.0.1:${port}/api/projects`)
				).json()) as { projects: { conversations: unknown[] }[] };

				expect(listed.projects[0]?.conversations).toEqual([
					{ id, name: "fake", status: "idle", checkpoint: null },
				]);
			} finally {
				await server.disposeAsync();
			}
		});

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

			const again = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{ launch: agent.launch },
			);
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
				(await (
					await fetch(`http://127.0.0.1:${port}/api/projects`)
				).json()) as {
					restarting: { resume: boolean } | null;
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
				expect((await listed(port)).restarting).toEqual({ resume: true });
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

		it("tells each one done with a checkpoint to carry on", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
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

				const response = await json(port, "/api/checkpoint/resume", "POST");

				expect(response.status).toBe(200);
				expect(conversation.state.checkpoint).toBeNull();
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(5);
				}
				expect(said).toEqual([CHECKPOINT, RESUME]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("asks only the conversations named, to retry those a checkpoint missed", async () => {
			const said: string[] = [];
			agent.turn = async (_, __, text) => {
				said.push(text);
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const start = async () => {
					const started = await json(port, "/api/conversations", "POST", {
						agent: "fake",
					});
					const { id } = (await started.json()) as { id: string };
					const conversation = await conversations.find(id);
					for (
						let i = 0;
						i < 100 && conversation.state.status !== "idle";
						i++
					) {
						await Bun.sleep(5);
					}
					return conversation;
				};
				const one = await start();
				const two = await start();

				await json(port, "/api/checkpoint", "POST", {
					projects: ["repo"],
					conversations: [two.id],
				});
				for (let i = 0; i < 100 && two.state.checkpoint !== "done"; i++) {
					await Bun.sleep(5);
				}

				expect(said).toEqual([CHECKPOINT]);
				expect(one.state.checkpoint).toBeNull();
			} finally {
				await server.disposeAsync();
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
				for (
					let i = 0;
					i < 100 && conversation.state.status !== "running";
					i++
				) {
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
					for (
						let i = 0;
						i < 100 && conversation.state.status !== "idle";
						i++
					) {
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

			const again = new Conversations(
				`${deps.arborDir}/conversations`,
				[AGENT],
				{ launch: agent.launch },
			);
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

		it("asks no one again while a checkpoint is under way", async () => {
			const said: string[] = [];
			agent.turn = (_, __, text) => {
				said.push(text);
				return new Promise(() => {});
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
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
				for (let i = 0; i < 100 && said.length === 0; i++) {
					await Bun.sleep(5);
				}
				await json(port, "/api/checkpoint", "POST", { projects: ["repo"] });
				await Bun.sleep(20);

				expect(agent.cancelled).toBe(0);
				expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
				expect(conversation.state.checkpoint).toBe("asked");
			} finally {
				await server.disposeAsync();
			}
		});

		it("starts one in a task's tree, streams the agent's turn, and archives it", async () => {
			await add(deps, "alpha");
			agent.turn = async (client, sessionId) => {
				await client.sessionUpdate({ sessionId, update: say("Hello ") });
				await client.sessionUpdate({ sessionId, update: say("there.") });
				return "end_turn";
			};
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const { port } = server;
				const listed = await (
					await fetch(`http://localhost:${port}/api/conversations`)
				).json();
				expect(listed).toEqual({
					agents: [
						{ id: "fake", name: "Fake", models: [], settings: [], limits: [] },
					],
					conversations: [],
				});

				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
					task: "alpha",
				});
				const { id } = (await started.json()) as { id: string };
				expect(agent.launched).toEqual([
					{
						argv: ["fake-acp"],
						cwd: (await deps.service.find("alpha")).path,
						env: {
							ARBOR_CONVERSATION: id,
							ARBOR_DEV: `http://localhost:${port}`,
						},
					},
				]);
				const events = await fetch(
					`http://localhost:${port}/api/conversations/events`,
				);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
				const form = new FormData();
				form.set("text", "hi");
				form.append(
					"file",
					new File(["mp4 bytes"], "bug.mp4", { type: "video/mp4" }),
				);
				for (let i = 0; i < 100; i++) {
					const response = await fetch(
						`http://localhost:${port}/api/conversations/${id}/prompt`,
						{
							method: "POST",
							headers: { origin: `http://localhost:${port}` },
							body: form,
						},
					);
					if (response.status === 200) {
						break;
					}
					// Still starting: the agent has yet to open its session.
					await Bun.sleep(5);
				}

				expect(await readUntil(reader, "Hello there.")).toContain(
					'"role":"agent"',
				);
				await reader.cancel();
				// The file sent with it plays from the server, a part at a time.
				const { conversations } = (await (
					await fetch(`http://localhost:${port}/api/conversations`)
				).json()) as { conversations: ConversationState[] };
				const sent = conversations.find((each) => each.id === id)?.messages[0]
					?.parts[0];
				expect(sent).toMatchObject({ type: "file", title: "bug.mp4" });
				const played = await fetch(
					`http://localhost:${port}/api/conversations/${id}/attachments/${sent?.type === "file" ? sent.name : ""}`,
					{ headers: { range: "bytes=0-2" } },
				);
				expect(played.status).toBe(206);
				expect(played.headers.get("content-type")).toBe("video/mp4");
				expect(await played.text()).toBe("mp4");
				const archived = await json(
					port,
					`/api/conversations/${id}/archived`,
					"PUT",
					{ archived: true },
				);
				expect(await archived.json()).toMatchObject({
					id,
					status: "stopped",
					archived: true,
				});
				expect(agent.killed).toBe(1);
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);

		it("refuses a conversation in a task with no worktree", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const response = await json(server.port, "/api/conversations", "POST", {
					agent: "fake",
					task: "nope",
				});

				expect(response.status).toBe(404);
				expect(agent.launched).toEqual([]);
			} finally {
				await server.disposeAsync();
			}
		});

		it("answers only to this machine, even for a host the board lets in", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				hosts: ["repo.arbor.example"],
				conversations: () => conversations,
			});
			try {
				const as = (host: string, path: string) =>
					fetch(`http://127.0.0.1:${server.port}${path}`, {
						headers: { host },
					});

				expect((await as("repo.arbor.example", "/api/snapshot")).status).toBe(
					200,
				);
				const refused = await as("repo.arbor.example", "/api/conversations");
				expect(refused.status).toBe(403);
				expect(await refused.json()).toMatchObject({
					message:
						"conversations and terminals run commands on this machine: open the page on it",
				});
				expect(
					(await as(`localhost:${server.port}`, "/api/conversations")).status,
				).toBe(200);
			} finally {
				await server.disposeAsync();
			}
		});

		it("refuses a start from another site", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				conversations: () => conversations,
			});
			try {
				const response = await fetch(
					`http://127.0.0.1:${server.port}/api/conversations`,
					{
						method: "POST",
						headers: { origin: "https://evil.example" },
						body: JSON.stringify({ agent: "fake" }),
					},
				);

				expect(response.status).toBe(403);
				expect(agent.launched).toEqual([]);
			} finally {
				await server.disposeAsync();
			}
		});
	});

	describe("terminal", () => {
		/** Asks for a terminal the way a browser would, and says how it went. */
		const knock = (port: number, headers: Record<string, string>, query = "") =>
			fetch(`http://127.0.0.1:${port}/api/terminal${query}`, {
				headers: {
					connection: "Upgrade",
					upgrade: "websocket",
					"sec-websocket-version": "13",
					"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
					origin: `http://127.0.0.1:${port}`,
					...headers,
				},
			});

		/** A terminal open on `query`, with everything it has said so far. */
		const terminal = async (port: number, query = "") => {
			// As a page would: Bun's client sends no Origin of its own. The DOM's
			// type for the constructor does not know Bun takes options here.
			const options: Bun.WebSocketOptions = {
				headers: { origin: `http://127.0.0.1:${port}` },
			};
			const socket = new WebSocket(
				`ws://127.0.0.1:${port}/api/terminal${query}`,
				options as string[],
			);
			socket.binaryType = "arraybuffer";
			const said = { screen: "", controls: [] as unknown[], closed: false };
			const decoder = new TextDecoder();
			socket.addEventListener("message", ({ data }) => {
				if (typeof data === "string") {
					said.controls.push(JSON.parse(data));
				} else {
					said.screen += decoder.decode(data as ArrayBuffer, { stream: true });
				}
			});
			socket.addEventListener("close", () => {
				said.closed = true;
			});
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve);
				socket.addEventListener("error", reject);
			});
			/** Waits for the shell to have written `text`, up to a few seconds. */
			const shows = async (text: string) => {
				for (let i = 0; i < 300 && !said.screen.includes(text); i++) {
					await Bun.sleep(10);
				}
				expect(said.screen).toContain(text);
			};
			return { socket, said, shows };
		};

		const opened = async (
			body: (port: number) => Promise<void>,
			options: { hosts?: string[] } = {},
		) => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				shell: ["/bin/sh"],
				...options,
			});
			try {
				await body(server.port);
			} finally {
				await server.disposeAsync();
			}
		};

		it("says it is off unless asked for", async () => {
			await serving(deps, async (_, port) => {
				const response = await knock(port, {});

				expect(response.status).toBe(404);
				expect(await response.json()).toMatchObject({
					message: "terminals are off",
				});
			});
		});

		it("runs a shell in the main tree", async () => {
			await opened(async (port) => {
				const { socket, shows } = await terminal(port);

				socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

				await shows(`at:${deps.service.git.root}`);
			});
		});

		it("runs a shell in a task's worktree", async () => {
			await add(deps, "alpha");
			const alpha = (await deps.service.find("alpha")).path;
			await opened(async (port) => {
				const { socket, shows } = await terminal(port, "?task=alpha");

				socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

				await shows(`at:${alpha}`);
			});
		});

		it("starts at the size asked for, and follows a resize", async () => {
			await opened(async (port) => {
				const { socket, shows } = await terminal(port, "?cols=100&rows=30");
				socket.send(new TextEncoder().encode("stty size\n"));
				await shows("30 100");

				socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
				socket.send(new TextEncoder().encode("stty size\n"));

				await shows("40 120");
			});
		});

		it("says how the shell exited, then closes", async () => {
			await opened(async (port) => {
				const { socket, said } = await terminal(port);

				socket.send(new TextEncoder().encode("exit 3\n"));

				for (let i = 0; i < 300 && !said.closed; i++) {
					await Bun.sleep(10);
				}
				expect(said).toMatchObject({
					controls: [{ type: "exit", code: 3 }],
					closed: true,
				});
			});
		});

		it("refuses one in a task with no worktree", async () => {
			await opened(async (port) => {
				const response = await knock(port, {}, "?task=nope");

				expect(response.status).toBe(404);
			});
		});

		it("refuses one opened from another site", async () => {
			await opened(async (port) => {
				const response = await knock(port, { origin: "https://evil.example" });

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					message: "a terminal opens only from its own page",
				});
			});
		});

		it("refuses one with an origin that is not one", async () => {
			await opened(async (port) => {
				const response = await knock(port, { origin: "" });

				expect(response.status).toBe(403);
			});
		});

		it("answers only to this machine, even for a host the board lets in", async () => {
			await opened(
				async (port) => {
					const response = await knock(port, {
						host: "repo.arbor.example",
						origin: "http://repo.arbor.example",
					});

					expect(response.status).toBe(403);
					expect(await response.json()).toMatchObject({
						message:
							"conversations and terminals run commands on this machine: open the page on it",
					});
				},
				{ hosts: ["repo.arbor.example"] },
			);
		});
	});
});
