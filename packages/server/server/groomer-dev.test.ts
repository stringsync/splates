import { describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeAgent } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations } from "../conversations";
import { HookStore } from "../hooks";
import { Testing } from "../testing";
import { dev } from "./server";
import { eventually } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("dev groomer", () => {
	// scry-ignore simple-test-setup: the groomer turned on in hooks.json, a server started over it and a task deferred while it runs are the wiring exercised here.
	it("grooms the backlog as it starts, and each task deferred while it runs", async () => {
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
		await new HookStore(deps.storage).groomer({
			agent: "fake",
		});
		await taskAdd(deps, "rough before", null);
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			expect(await eventually(async () => told.length === 1, 5000)).toBe(true);
			await deps.journal.record(
				"task add",
				null,
				() => taskAdd(deps, "rough while up", null),
				(task) => ({
					number: task.id,
					subject: task.subject,
					lane: null,
					position: task.position,
					ready: false,
				}),
			);
			expect(await eventually(async () => told.length === 2, 5000)).toBe(true);

			expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #2]"]);
			expect(
				(await conversations.list()).every(
					({ state }) => state.persistent === "groomer",
				),
			).toBe(true);
		} finally {
			await server.disposeAsync();
		}
	});
});
