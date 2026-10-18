import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { AGENT, FakeAgent, ROSTERED } from "./agents/testing";
import { Conversations } from "./conversations";
import { dev } from "./index";
import { Offered } from "./models";
import { Testing } from "./testing";

describe("dev dispatched", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		agent.options = [
			...agent.options,
			{
				id: "effort",
				name: "Effort",
				category: "thought_level",
				type: "select",
				currentValue: "default",
				options: [
					{ value: "default", name: "Default" },
					{ value: "high", name: "High" },
				],
			},
		];
		const offered = new Offered(`${deps.splatesHome}/offered.json`, {
			fs: deps.fs,
		});
		await offered.remember("fake", [
			{
				id: "effort",
				name: "Effort",
				type: "select",
				category: "thought_level",
				current: "default",
				options: [
					{ value: "default", name: "Default", description: null },
					{ value: "high", name: "High", description: null },
				],
			},
		]);
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch, offered },
		);
	});

	afterEach(() => deps.disposeAsync());

	it("starts the agent of a task handed to one at the thinking level it was handed", async () => {
		const told = Promise.withResolvers<string>();
		agent.turn = async (_, __, text) => {
			told.resolve(text);
			return "end_turn";
		};
		await add(deps, "alpha", {
			dispatch: { agent: "fake", effort: "high" },
			agents: [ROSTERED],
		});
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			await told.promise;

			expect(agent.chosen).toEqual([{ configId: "effort", value: "high" }]);
		} finally {
			await server.disposeAsync();
		}
	});
});
