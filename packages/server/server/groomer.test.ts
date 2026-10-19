import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { AGENT, FakeAgent, say } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations, GROOMER_ROLE } from "../conversations";
import { once } from "../conversations/testing";
import { add } from "../tasks";
import { Testing } from "../testing";
import { Groomer } from "./groomer";

describe("Groomer", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let groomer: Groomer;
	let told: string[];

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		told = [];
		agent.turn = async (_, __, text) => {
			told.push(text);
			return "end_turn";
		};
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		groomer = new Groomer({
			tasks: () => deps.tasks.all(),
			conversations,
			root: deps.service.git.root,
			log: new MemoryLogger(),
		});
	});

	afterEach(async () => {
		groomer.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("grooms the backlog in order, a turn at a time, in one conversation per run, archived resting as the run ends", async () => {
		await taskAdd(deps, "rough", null);
		await taskAdd(deps, "groomed", null, { ready: true });
		await taskAdd(deps, "taken", null);
		await taskAdd(deps, "rougher", null);
		await add(deps, "work", { tasks: [3] });

		await groomer.wake({ agent: "fake" });

		expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #4]"]);
		const kept = await conversations.persistent(GROOMER_ROLE);
		expect((await conversations.list()).map(({ id }) => id)).toEqual([
			kept?.id ?? "",
		]);
		expect((await deps.tasks.find(1)).state.grooming).toBe(kept?.id);
		expect(kept?.state).toMatchObject({ archived: true, resting: true });
		expect(kept?.state.status).toBe("stopped");
	});

	it("leaves a task a run had its turn on, and starts the next run afresh", async () => {
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		const first = await conversations.persistent(GROOMER_ROLE);
		await groomer.wake({ agent: "fake" });
		await taskAdd(deps, "later", null);

		await groomer.wake({ agent: "fake" });

		expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #2]"]);
		const second = await conversations.persistent(GROOMER_ROLE);
		expect(second?.id).not.toBe(first?.id);
		expect(second?.state.messages.map(({ role }) => role)).toEqual(["user"]);
		expect(await conversations.list()).toHaveLength(2);
	});

	it("leaves a run that ends asking you something open, and archives it once a turn after your reply asks nothing", async () => {
		agent.turn = async (client, sessionId, text) => {
			told.push(text);
			await client.sessionUpdate({
				sessionId,
				update: say(
					text.startsWith("[SPLATES GROOM")
						? "1. Which lane should #1 go in?\n   - (a) Lane 1 (chosen)\n   - (b) Lane 2"
						: "#1: ready in lane 1",
				),
			});
			return "end_turn";
		};
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		const asking = await conversations.find(
			(await conversations.persistent(GROOMER_ROLE))?.id ?? "",
		);
		expect(asking.state.archived).toBe(false);

		await asking.prompt("1. a", []);
		await once(asking, () => asking.state.archived);

		expect(asking.state.resting).toBe(true);
	});

	it("goes round again for a wake that comes mid-turn", async () => {
		await taskAdd(deps, "rough", null);
		const first = groomer.wake({ agent: "fake" });
		await taskAdd(deps, "while grooming", null);
		const second = groomer.wake({ agent: "fake" });

		await Promise.all([first, second]);

		expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #2]"]);
	});

	it("retires its conversation, no longer resting, once turned off, and starts afresh once on again", async () => {
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		const kept = await conversations.persistent(GROOMER_ROLE);

		await groomer.wake(null);
		expect(kept?.state).toMatchObject({ archived: true, resting: false });

		await taskAdd(deps, "later", null);
		await groomer.wake({ agent: "fake" });
		expect(told.at(-1)).toBe("[SPLATES GROOM #2]");
		const next = await conversations.persistent(GROOMER_ROLE);
		expect(next?.id).not.toBe(kept?.id);
		expect(next?.state).toMatchObject({ archived: true, resting: true });
	});

	it("keeps its newest run resting while paused, so its row stays, even one turning it off retired", async () => {
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		const kept = await conversations.persistent(GROOMER_ROLE);

		await groomer.wake("paused");
		expect(kept?.state).toMatchObject({ archived: true, resting: true });

		await groomer.wake(null);
		await groomer.wake("paused");
		expect(kept?.state).toMatchObject({ archived: true, resting: true });
		expect(told).toEqual(["[SPLATES GROOM #1]"]);
	});

	it("grooms nothing while paused", async () => {
		await taskAdd(deps, "rough", null);

		await groomer.wake("paused");

		expect(told).toEqual([]);
		expect(await conversations.persistent(GROOMER_ROLE)).toBeNull();
	});
});
