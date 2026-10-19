import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "../conversations";
import { Testing } from "../testing";
import { dev } from "./server";
import { json } from "./testing";

describe("dev conversations an orchestrator started", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;
	let orchestrator: Conversation;
	let handed: Conversation;

	const until = async (done: () => boolean) => {
		for (let i = 0; i < 200 && !done(); i++) {
			await Bun.sleep(10);
		}
	};

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		orchestrator = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		handed = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
			startedBy: orchestrator.id,
		});
		await until(
			() =>
				orchestrator.state.status === "idle" && handed.state.status === "idle",
		);
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	const write = (id: string, path: string, method: string, body: object) =>
		json(server.port, `/api/conversations/${id}/${path}`, method, body);

	it("takes words only from the orchestrator that started it", async () => {
		const said: string[] = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		const stranger = await write(handed.id, "tell", "POST", {
			from: "someone",
			text: "drop it",
		});
		const told = await write(handed.id, "tell", "POST", {
			from: orchestrator.id,
			text: "> **Keep it?**\n- (a) Keep it",
		});
		await until(() => said.length === 1);

		expect((await stranger.json()).reason).toBe("usage");
		expect(told.status).toBe(200);
		expect(said).toEqual(["> **Keep it?**\n- (a) Keep it"]);
	});

	it("goes with the orchestrator that started it when that is archived, and comes back with it", async () => {
		await write(orchestrator.id, "archived", "PUT", { archived: true });

		expect(handed.state).toMatchObject({
			archived: true,
			archivedWith: orchestrator.id,
			status: "stopped",
		});

		await write(orchestrator.id, "archived", "PUT", { archived: false });

		expect(handed.state).toMatchObject({
			archived: false,
			archivedWith: null,
		});
	});
});
