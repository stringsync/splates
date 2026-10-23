import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "../conversations";
import { Testing } from "../testing";
import { dev } from "./server";
import { json } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("dev conversations a lane's orchestrator started, from before agents stopped starting agents", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
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
		agent.turn = async () => "end_turn";
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
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

	it("takes the page's writes, as the person's to talk to", async () => {
		const named = await write(started.id, "name", "PUT", { name: "mine" });

		expect(named.status).toBe(200);
		expect(started.state.name).toBe("mine");
	});

	it("goes with the orchestrator when it is archived, and comes back with it", async () => {
		await write(orchestrator.id, "archived", "PUT", { archived: true });

		expect(orchestrator.state.archived).toBe(true);
		expect(started.state).toMatchObject({
			archived: true,
			archivedWith: orchestrator.id,
		});

		await write(orchestrator.id, "archived", "PUT", { archived: false });

		expect(orchestrator.state.archived).toBe(false);
		expect(started.state.archived).toBe(false);
	});
});
