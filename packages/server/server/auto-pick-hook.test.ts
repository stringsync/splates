import { describe, expect, it } from "bun:test";
import { OpenPortProvider } from "core/system";
import { FakeAgent } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations } from "../conversations";
import { HookStore } from "../hooks";
import { Testing } from "../testing";
import { dev } from "./server";
import { eventually } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("an agent hook on Auto pick", () => {
	// vet-ignore simple-test-setup: a hook naming no agent in hooks.json, a server started over it and a task event it fires on are the wiring exercised here.
	it("starts the agent Auto pick picks, told the event and the hook's prompt", async () => {
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
			{ kind: "agent", prompt: "Say hello to the new task." },
		);
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			await deps.journal.record(
				"task add",
				null,
				() => taskAdd(deps, "a new task", null),
				(task) => ({
					number: task.id,
					subject: task.subject,
					lane: null,
					position: task.position,
					ready: false,
				}),
			);
			expect(await eventually(async () => told.length === 1, 5000)).toBe(true);

			expect(told[0]).toEndWith("Say hello to the new task.");
			const [started] = await conversations.list();
			expect(started?.state).toMatchObject({
				agent: "fake",
				automation: automation.id,
				task: null,
			});
			expect(await deps.journal.tail(10)).toContainEqual(
				expect.objectContaining({
					action: "auto",
					conversation: started?.id,
					agent: "fake",
				}),
			);
		} finally {
			await server.disposeAsync();
		}
	});

	// vet-ignore simple-test-setup: a hook naming no agent in hooks.json, a server started over it and a task event it fires on are the wiring exercised here.
	it("names the conversation it starts after the automation", async () => {
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
		const _automation = await new HookStore(deps.storage).add(
			{ event: "task.created" },
			{ kind: "agent", prompt: "Say hello to the new task." },
			"Greeter",
		);
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			await deps.journal.record(
				"task add",
				null,
				() => taskAdd(deps, "a new task", null),
				(task) => ({
					number: task.id,
					subject: task.subject,
					lane: null,
					position: task.position,
					ready: false,
				}),
			);
			expect(await eventually(async () => told.length === 1, 5000)).toBe(true);

			const [started] = await conversations.list();
			expect(started?.state.name).toBe("Greeter");
		} finally {
			await server.disposeAsync();
		}
	});
});
