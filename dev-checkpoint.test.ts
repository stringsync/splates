import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";
import { Testing } from "./testing";

describe("dev checkpoint", () => {
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
				for (let i = 0; i < 100 && conversation.state.status !== "idle"; i++) {
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
});
