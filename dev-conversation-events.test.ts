import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eventually } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { ConversationEvents } from "./dev-conversation-events";
import { AGENT, FakeAgent } from "./fake-agent";
import { Testing } from "./testing";

describe("conversation events", () => {
	let deps: Testing;
	let conversations: Conversations;
	let conversation: Conversation;
	let following: ConversationEvents;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{ launch: new FakeAgent().launch },
		);
		conversation = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		// Logged before the server opened the project.
		await claimed("alpha", conversation.id);
		await claimed("external", null);
		following = await ConversationEvents.follow({
			journal: deps.journal,
			conversations,
			fs: deps.fs,
			arborDir: deps.arborDir,
			log: deps.log,
		});
	});

	afterEach(async () => {
		following.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	/** Logs a claim of `task` as the agent of `by` would, or an external one for null. */
	const claimed = async (task: string, by: string | null) => {
		if (by === null) {
			delete deps.proc.env.ARBOR_CONVERSATION;
		} else {
			deps.proc.env.ARBOR_CONVERSATION = by;
		}
		await deps.journal.record(
			"claim",
			task,
			async () => ({ escalated: false, tookOver: false }),
			(out) => out,
		);
		delete deps.proc.env.ARBOR_CONVERSATION;
	};

	it("hands a conversation the events its agent logged before the server opened", () => {
		expect(conversation.state.events).toMatchObject([
			{ action: "claim", task: "alpha", conversation: conversation.id },
		]);
	});

	it("hands it each new event as the journal takes it, and an external agent's to none", async () => {
		// Logged ahead of the last, so they are read by the time it is.
		await claimed("gamma", null);
		await claimed("delta", "some-other-conversation");
		await claimed("beta", conversation.id);

		await eventually(() => conversation.state.events.length === 2, 10);

		expect(conversation.state.events.map((event) => event.task)).toEqual([
			"alpha",
			"beta",
		]);
	});

	it("hands the server's start and stop to each conversation they name as running", async () => {
		await deps.journal.record("dev stop", null, async () => {}, {
			conversations: [conversation.id, "other"],
			why: "restart",
		});
		await deps.journal.record("dev start", null, async () => {}, {
			conversations: ["other"],
		});
		await claimed("beta", conversation.id);

		await eventually(() => conversation.state.events.length === 3, 10);

		expect(conversation.state.events.map((event) => event.action)).toEqual([
			"claim",
			"dev stop",
			"claim",
		]);
	});
});
