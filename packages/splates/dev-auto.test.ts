import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent, ROSTERED } from "./fake-agent";
import { Testing } from "./testing";

describe("dev Auto", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({
				agents: [
					{
						...ROSTERED,
						models: [
							{ ...ROSTERED.models[1], tier: 1, speed: "fast", costRank: 1 },
							{ ...ROSTERED.models[0], tier: 4, speed: "slow", costRank: 4 },
						],
					},
				],
			}),
		);
	});

	afterEach(() => deps.disposeAsync());

	it("starts on the pick, logs it in the conversation, and asks once for the judge's key", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			// Answered before the pick, which is logged before the agent opens.
			const start = async () => {
				const started = (await (
					await json(server.port, "/api/conversations/auto", "POST", {
						task: null,
						prompt: "Rename `foo` to `bar`",
					})
				).json()) as {
					id: string;
					agent: string;
					assigned: boolean;
					auto: boolean;
					picking: boolean;
				};
				await (await conversations.find(started.id)).opening;
				return started;
			};
			const started = await start();
			expect(started).toMatchObject({
				agent: "fake",
				assigned: true,
				auto: true,
				picking: true,
			});

			const events = await deps.journal.tail(10);
			expect(events).toContainEqual(
				expect.objectContaining({
					action: "auto",
					conversation: started.id,
					agent: "fake",
					model: "big",
					effort: null,
					signs: null,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					action: "creds request",
					conversation: started.id,
					name: "TYPESAFE_API_KEY",
					asked: true,
				}),
			);

			await start();
			const requests = (await deps.journal.tail(10)).filter(
				(each) => each.action === "creds request",
			);
			expect(requests).toHaveLength(1);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);
});
