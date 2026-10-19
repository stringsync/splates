import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { AGENT, FakeAgent } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations, GROOMER_ROLE } from "../conversations";
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
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("grooms the backlog in order, a turn at a time, in one persistent conversation", async () => {
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
	});

	it("leaves a task it had its turn on, and tells the same conversation of the next", async () => {
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		await groomer.wake({ agent: "fake" });
		await taskAdd(deps, "later", null);

		await groomer.wake({ agent: "fake" });

		expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #2]"]);
		expect(await conversations.list()).toHaveLength(1);
	});

	it("goes round again for a wake that comes mid-turn", async () => {
		await taskAdd(deps, "rough", null);
		const first = groomer.wake({ agent: "fake" });
		await taskAdd(deps, "while grooming", null);
		const second = groomer.wake({ agent: "fake" });

		await Promise.all([first, second]);

		expect(told).toEqual(["[SPLATES GROOM #1]", "[SPLATES GROOM #2]"]);
	});

	it("retires its conversation once turned off, and carries on in it once on again", async () => {
		await taskAdd(deps, "rough", null);
		await groomer.wake({ agent: "fake" });
		const kept = await conversations.persistent(GROOMER_ROLE);

		await groomer.wake(null);
		expect(kept?.state.archived).toBe(true);

		await taskAdd(deps, "later", null);
		await groomer.wake({ agent: "fake" });
		expect(told.at(-1)).toBe("[SPLATES GROOM #2]");
		expect(kept?.state.archived).toBe(false);
	});
});
