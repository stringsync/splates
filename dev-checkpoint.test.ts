import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { eventually } from "./conversation-testing";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { atWork, json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT } from "./prompts";
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
			exit: () => {},
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

			expect((await json(port, "/api/checkpoint", "POST")).status).toBe(400);
			const unsaid = await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
			});
			expect(await unsaid.text()).toContain("resume or shutdown");
			const response = await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "resume",
			});

			expect(response.status).toBe(200);
			await eventually(() => conversation.state.checkpoint === "done", 5);
			expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
		} finally {
			await server.disposeAsync();
		}
	});

	it("lists each project's conversations at work, for its checkpoint, passing over the idle ones", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit: () => {},
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
			const resting = (await (
				await json(port, "/api/conversations", "POST", { agent: "fake" })
			).json()) as { id: string };
			const idle = await conversations.find(resting.id);
			await eventually(() => idle.state.status === "idle", 5);

			const listed = (await (
				await fetch(`http://127.0.0.1:${port}/api/projects`)
			).json()) as { projects: { conversations: unknown[] }[] };

			expect(listed.projects[0]?.conversations).toEqual([
				{ id, name: "fake", status: "running", checkpoint: null },
			]);
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
			exit: () => {},
		});
		try {
			const { port } = server;
			const start = async () => {
				const started = await json(port, "/api/conversations", "POST", {
					agent: "fake",
				});
				const { id } = (await started.json()) as { id: string };
				const conversation = await conversations.find(id);
				await eventually(() => conversation.state.status === "idle", 5);
				await atWork(agent, conversation);
				return conversation;
			};
			const one = await start();
			const two = await start();

			await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "resume",
				conversations: [two.id],
			});
			await eventually(() => two.state.checkpoint === "done", 5);

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
			exit: () => {},
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
			await eventually(() => said.length !== 0, 5);
			await json(port, "/api/checkpoint", "POST", {
				projects: ["repo"],
				after: "resume",
			});
			await Bun.sleep(20);

			expect(agent.cancelled).toBe(1);
			expect(said).toEqual(["[ARBOR CHECKPOINT]"]);
			expect(conversation.state.checkpoint).toBe("asked");
		} finally {
			await server.disposeAsync();
		}
	});
});
