import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { FakeFs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent } from "../agents/testing";
import { type ConversationState, Conversations } from "./index";
import { until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("Conversation progress", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/login", "/tmp/tasks"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{ fs, timer, clock, ids: new CounterIdProvider(), launch: agent.launch },
		);
	});

	afterEach(() => conversations.disposeAsync());

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	/** The conversation as a server started again reads it back from its log. */
	const readBack = async (): Promise<ConversationState | undefined> => {
		const reread = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [back] = await reread.list();
		const state = back?.state;
		await reread.disposeAsync();
		return state;
	};

	it("keeps a running card on the state, and in the log as stopped once read back", async () => {
		const conversation = await started();

		conversation.reportProgress({ id: "import", title: "Import", percent: 10 });
		await conversation.log.flush();

		expect(conversation.state.progress).toHaveLength(1);
		expect(conversation.state.progress[0]?.state).toBe("running");
		// A server started again has no agent process, as for background commands.
		expect((await readBack())?.progress[0]).toMatchObject({
			id: "import",
			state: "stopped",
			percent: 10,
		});
	});

	it("tells the page of a burst a couple of times, not once per update", async () => {
		const conversation = await started();
		let heard = 0;
		conversation.events.on("changed", () => heard++);

		for (let step = 0; step < 500; step++) {
			conversation.reportProgress({ id: "import", note: `step ${step}` });
		}
		timer.fireTimeouts();

		expect(heard).toBeLessThanOrEqual(3);
		expect(conversation.state.progress[0]?.note).toBe("step 499");
	});

	it("clears its cards when archived, also after a reread", async () => {
		const conversation = await started();
		conversation.reportProgress({ id: "import", note: "going" });
		conversation.reportProgress({ id: "import", note: "gone on" });

		await conversation.archive();
		timer.fireTimeouts();

		expect(conversation.state.progress).toEqual([]);
		await conversation.log.flush();
		expect((await readBack())?.progress).toEqual([]);
	});

	it("stops a running card when the agent's process ends, also after a reread", async () => {
		const conversation = await started();
		conversation.reportProgress({ id: "import", note: "going" });

		await conversation.stop();

		expect(conversation.state.progress[0]?.state).toBe("stopped");
		expect((await readBack())?.progress[0]?.state).toBe("stopped");
	});
});
