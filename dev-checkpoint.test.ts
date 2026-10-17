import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { eventually } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { dev } from "./dev";
import { atWork, json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT } from "./prompts";
import { Testing } from "./testing";

describe("dev checkpoint", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;
	let port: number;
	// What the agent was told, each turn ending as `turn` says.
	let said: string[];
	let turn: () => Promise<"end_turn">;
	// Ends the turn held by `hold`.
	let release: (() => void) | undefined;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		said = [];
		turn = async () => "end_turn";
		agent.turn = (_, __, text) => {
			said.push(text);
			return turn();
		};
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{
				launch: agent.launch,
			},
		);
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
			exit: () => {},
		});
		port = server.port;
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	// Holds each turn after this until `release`.
	const hold = () => {
		turn = () =>
			new Promise((resolve) => (release = () => resolve("end_turn")));
	};

	// A conversation started and left idle.
	const idle = async (): Promise<Conversation> => {
		const started = await json(port, "/api/conversations", "POST", {
			agent: "fake",
		});
		const { id } = (await started.json()) as { id: string };
		const conversation = await conversations.find(id);
		await eventually(() => conversation.state.status === "idle", 5);
		return conversation;
	};

	// A conversation whose agent is at work until cancelled.
	const working = async (): Promise<Conversation> => {
		const conversation = await idle();
		await atWork(agent, conversation);
		return conversation;
	};

	const listed = async (): Promise<unknown[] | undefined> => {
		const read = (await (
			await fetch(`http://127.0.0.1:${port}/api/projects`)
		).json()) as { projects: { conversations: unknown[] }[] };
		return read.projects[0]?.conversations;
	};

	it("checkpoints the live ones of each project named", async () => {
		const conversation = await working();

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
		expect(said).toEqual([CHECKPOINT]);
	});

	it("lists each project's conversations at work, for its checkpoint, passing over the idle ones", async () => {
		const { id } = await working();
		await idle();

		expect(await listed()).toEqual([
			{
				id,
				name: "fake",
				status: "running",
				checkpoint: null,
				survives: false,
			},
		]);
	});

	it("asks only the conversations named, to retry those a checkpoint missed", async () => {
		const one = await working();
		const two = await working();

		await json(port, "/api/checkpoint", "POST", {
			projects: ["repo"],
			after: "resume",
			conversations: [two.id],
		});
		await eventually(() => two.state.checkpoint === "done", 5);

		expect(said).toEqual([CHECKPOINT]);
		expect(one.state.checkpoint).toBeNull();
	});

	it("asks no one again while a checkpoint is under way", async () => {
		hold();
		const conversation = await working();

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
		expect(said).toEqual([CHECKPOINT]);
		expect(conversation.state.checkpoint).toBe("asked");
	});

	it("pauses one at work, out of Power's sight, and leaves it stopped once it checkpoints", async () => {
		hold();
		const conversation = await working();

		const paused = await json(
			port,
			`/api/conversations/${conversation.id}/pause`,
			"POST",
		);

		expect(paused.status).toBe(200);
		await eventually(() => said.length > 0, 5);
		expect(said).toEqual([CHECKPOINT]);
		expect(conversation.state).toMatchObject({
			checkpoint: "asked",
			pausing: true,
		});
		expect(await listed()).toEqual([]);

		release?.();
		await eventually(() => conversation.state.status === "idle", 5);
		expect(conversation.state).toMatchObject({
			checkpoint: null,
			pausing: false,
		});
		const again = await json(
			port,
			`/api/conversations/${conversation.id}/pause`,
			"POST",
		);
		expect(await again.text()).toContain("only a running agent pauses");
	});
});
