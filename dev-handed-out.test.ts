import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { type Conversation, Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { Testing } from "./testing";

describe("dev conversations handed a task", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let said: string[];
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
		said = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
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
			handedBy: orchestrator.id,
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

	it("refuses the page any write to it while the conversation it answers to is there", async () => {
		const refused = await Promise.all([
			write(handed.id, "name", "PUT", { name: "mine" }),
			write(handed.id, "archived", "PUT", { archived: true }),
			write(handed.id, "cancel", "POST", {}),
		]);

		expect(
			await Promise.all(
				refused.map(async (each) => (await each.json()).reason),
			),
		).toEqual(["blocked", "blocked", "blocked"]);
		expect(handed.state).toMatchObject({ name: null, archived: false });
	});

	it("takes words only from the conversation that handed it its task", async () => {
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

	it("terminates its agent and tells the conversation that handed it out", async () => {
		const terminated = await write(handed.id, "terminate", "POST", {});
		await until(() => said.length === 1);

		expect(await terminated.json()).toMatchObject({ status: "stopped" });
		expect(said).toEqual([`[ARBOR STOPPED ${handed.id}]`]);
	});

	it("goes with the one it answers to when that is archived, and comes back with it", async () => {
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
