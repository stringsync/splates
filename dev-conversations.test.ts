import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { type ConversationState, Conversations } from "./conversations";
import { dev } from "./dev";
import { json, readUntil, serving } from "./dev-testing";
import { AGENT, FakeAgent, heard, ROSTERED, say } from "./fake-agent";
import { Testing } from "./testing";

describe("dev conversations", () => {
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

			const brought = await json(port, "/api/conversations/sessions", "POST", {
				agent: "fake",
				session: "cli-1",
				task: "alpha",
				title: "From the CLI",
			});
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

	it("removes a task, stopping each conversation in its tree and moving it to the main tree", async () => {
		await add(deps, "alpha");
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			hosts: ["repo.arbor.example"],
			conversations: () => conversations,
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
				task: "alpha",
			});
			const { id } = (await started.json()) as { id: string };
			const conversation = await conversations.find(id);
			while (conversation.state.status === "starting") {
				await Bun.sleep(5);
			}
			const removeAs = (host: string) =>
				fetch(`http://127.0.0.1:${port}/api/tasks/alpha`, {
					method: "DELETE",
					headers: { host, origin: `http://${host}` },
				});

			// It discards work, so it answers only to this machine.
			expect((await removeAs("repo.arbor.example")).status).toBe(403);
			expect((await deps.service.find("alpha")).gone).toBe(false);

			expect((await removeAs(`localhost:${port}`)).status).toBe(200);
			expect((await deps.service.find("alpha")).gone).toBe(true);
			expect(conversation.state).toMatchObject({
				task: null,
				lastTask: "alpha",
				status: "stopped",
				archived: false,
			});
			expect(agent.killed).toBe(1);
			expect(await (await removeAs(`localhost:${port}`)).json()).toMatchObject({
				reason: "already_removed",
			});
		} finally {
			await server.disposeAsync();
		}
	});

	it("follows its agent into a task, but not into a part of its own task", async () => {
		await add(deps, "alpha");
		await add(deps, "part", { base: "task/alpha" });
		await add(deps, "subpart", { base: "task/part" });
		await add(deps, "beta");
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
				task: "alpha",
			});
			const { id } = (await started.json()) as { id: string };
			const moveTo = async (task: string, base?: string) =>
				(
					(await (
						await json(port, `/api/conversations/${id}/task`, "PUT", {
							task,
							base,
						})
					).json()) as ConversationState
				).task;

			// A subagent claiming a part runs with this conversation's env.
			expect(await moveTo("part")).toBe("alpha");
			expect(await moveTo("subpart")).toBe("alpha");
			// Handing a part out tells the server before its record names the
			// base, so the add sends the base itself.
			const added: (string | null)[] = [];
			await add(deps, "late", {
				base: "task/alpha",
				onTree: async () => {
					added.push(await moveTo("late", "task/alpha"));
				},
			});
			expect(added).toEqual(["alpha"]);
			expect(await moveTo("beta")).toBe("beta");
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
					"conversations and terminals run commands on this machine: open the page on it, or put Cloudflare Access in front with --access-team and --access-aud",
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
