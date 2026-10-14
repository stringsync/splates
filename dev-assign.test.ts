import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent, ROSTERED } from "./fake-agent";
import { Testing } from "./testing";

describe("dev assign", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let _conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		_conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{
				launch: agent.launch,
			},
		);
	});

	afterEach(() => deps.disposeAsync());

	it("assigns a todo an agent off the roster, and starts a conversation on a model", async () => {
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
			expect((await deps.todos.find(1)).state.assignee).toEqual({
				agent: "fake",
				model: "small",
			});
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
});
