import { describe, expect, it } from "bun:test";
import { OpenPortProvider } from "core/system";
import { FakeAgent } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations } from "../conversations";
import { HookStore } from "../hooks";
import { EVAL_BUDGET_APPROVED } from "../plans";
import { Testing } from "../testing";
import { dev } from "./server";
import { eventually } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("an automation with a pre-approved eval budget", () => {
	// vet-ignore simple-test-setup: an agent hook with evalBudget, a server over it and two firings are the wiring exercised here.
	it("seeds the eval budget onto each firing's conversation with no carryover and tells the agent", async () => {
		await using deps = await Testing.open();
		const agent = new FakeAgent();
		const told: string[] = [];
		agent.turn = async (_, __, text) => {
			told.push(text);
			return "end_turn";
		};
		const conversations = new Conversations(
			`${deps.dir}/conversations`,
			[AGENT],
			{ storage: deps.storage.within("conversations"), launch: agent.launch },
		);
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({ agents: [{ ...AGENT, models: [] }] }),
		);
		const automation = await new HookStore(deps.storage).add(
			{ event: "task.created" },
			{ kind: "agent", prompt: "Run top evals.", evalBudget: 2 },
			"Spend unused quota",
		);
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const fireOnce = async (subject: string) =>
				deps.journal.record(
					"task add",
					null,
					() => taskAdd(deps, subject, null),
					(task) => ({
						number: task.id,
						subject: task.subject,
						lane: null,
						position: task.position,
						ready: false,
					}),
				);
			await fireOnce("first firing");
			expect(await eventually(async () => told.length === 1, 5000)).toBe(true);
			await fireOnce("second firing");
			expect(await eventually(async () => told.length === 2, 5000)).toBe(true);

			const approval = `${EVAL_BUDGET_APPROVED}\n\nPre-approved $2.00 by automation "Spend unused quota": $2.00 of $2.00 left.`;
			expect(told).toEqual([
				expect.stringContaining(`Run top evals.\n\n${approval}`),
				expect.stringContaining(`Run top evals.\n\n${approval}`),
			]);
			const started = await conversations.list();
			const budgets = await Promise.all(
				started.map((each) =>
					fetch(
						`http://127.0.0.1:${server.port}/api/evals/budget?conversation=${encodeURIComponent(each.id)}`,
					).then((response) => response.json()),
				),
			);
			const expected = {
				usd: 2,
				spent: 0,
				answers: {},
				seeded: {
					usd: 2,
					automation: automation.id,
					name: "Spend unused quota",
				},
			};
			expect(budgets).toEqual([expected, expected]);
		} finally {
			await server.disposeAsync();
		}
	});
});
