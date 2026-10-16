import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { type Conversation, Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent, ROSTERED } from "./fake-agent";
import { Testing } from "./testing";

describe("dev conversations a lane's orchestrator started", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let said: string[];
	let server: Awaited<ReturnType<typeof dev>>;
	let orchestrator: Conversation;
	let started: Conversation;

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
		started = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
			startedBy: orchestrator.id,
		});
		await until(
			() =>
				orchestrator.state.status === "idle" && started.state.status === "idle",
		);
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	const write = (id: string, path: string, method: string, body: object) =>
		json(server.port, `/api/conversations/${id}/${path}`, method, body);

	it("starts the agent it hands a todo to answering to the person, it the starter", async () => {
		deps.proc.env.ARBOR_CONVERSATION = orchestrator.id;
		await add(deps, "alpha", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		await until(() => said.includes("[ARBOR TASK alpha]"));
		const [alpha] = (await conversations.list()).filter(
			(each) => each.state.task === "alpha",
		);

		expect(alpha?.state).toMatchObject({
			handedBy: null,
			startedBy: orchestrator.id,
			messages: [{ told: orchestrator.id }],
		});
		expect(agent.launched.at(-1)?.env).toMatchObject({
			ARBOR_STARTED_BY: orchestrator.id,
		});
		expect(agent.launched.at(-1)?.env).not.toHaveProperty("ARBOR_CALLER");
	});

	it("takes the page's writes, as the person's to talk to", async () => {
		const named = await write(started.id, "name", "PUT", { name: "mine" });

		expect(named.status).toBe(200);
		expect(started.state.name).toBe("mine");
	});

	it("takes words from the orchestrator that started it, and no one else", async () => {
		const stranger = await write(started.id, "tell", "POST", {
			from: "someone",
			text: "drop it",
		});
		const told = await write(started.id, "tell", "POST", {
			from: orchestrator.id,
			text: "Carry on.",
		});
		await until(() => said.length === 1);

		expect((await stranger.json()).reason).toBe("usage");
		expect(told.status).toBe(200);
		expect(said).toEqual(["Carry on."]);
	});

	// scry-ignore simple-test-setup: only this test holds a turn open, to stop it
	it("stops its turn first when told to stop, for a change of plans", async () => {
		const held = Promise.withResolvers<void>();
		// The first turn waits on `held`; the one after it, on nothing.
		const gates = [held.promise];
		agent.turn = async (_, __, text) => {
			said.push(text);
			await gates.shift();
			return "end_turn";
		};
		void started.prompt("Build the table.");
		await until(() => started.state.status === "running");
		const told = await write(started.id, "tell", "POST", {
			from: orchestrator.id,
			text: "Stop: the lane changed.",
			stop: true,
		});
		held.resolve();
		await until(() => said.length === 2 && started.state.status === "idle");

		expect(told.status).toBe(200);
		expect(said).toEqual(["Build the table.", "Stop: the lane changed."]);
		expect(agent.cancelled).toBe(1);
	});

	it("stays when the orchestrator is archived", async () => {
		await write(orchestrator.id, "archived", "PUT", { archived: true });

		expect(orchestrator.state.archived).toBe(true);
		expect(started.state.archived).toBe(false);
	});
});
