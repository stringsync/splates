import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeAgent } from "../agents/testing";
import { Journal } from "../records";
import { Testing } from "../testing";
import type { Conversation } from "./conversation";
import { Conversations } from "./conversations";
import { JournalEvents } from "./events";
import { eventually } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("conversation events", () => {
	let deps: Testing;
	let conversations: Conversations;
	let conversation: Conversation;
	let following: JournalEvents;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: new FakeAgent().launch,
		});
		conversation = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		// Logged before the server opened the project.
		await claimed("alpha", conversation.id);
		await claimed("external", null);
		following = await JournalEvents.follow({
			journal: new Journal(deps.storage, deps.config.logCapacity, {
				ps: deps.ps,
			}),
			conversations,
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
			delete deps.proc.env.SPLATES_CONVERSATION;
		} else {
			deps.proc.env.SPLATES_CONVERSATION = by;
		}
		await deps.journal.record(
			"claim",
			task,
			async () => ({ tookOver: false, goal: "" }),
			(out) => out,
		);
		delete deps.proc.env.SPLATES_CONVERSATION;
	};

	it("hands a conversation the events its agent logged before the server opened", () => {
		expect(conversation.state.events).toMatchObject([
			{ action: "claim", task: "alpha", conversation: conversation.id },
		]);
	});

	it("delivers new events without echoing journal activity to the server log", async () => {
		await claimed("external-noise", null);
		await claimed("quiet", conversation.id);
		await eventually(() => conversation.state.events.length === 2, 100);
		await following.changed();

		expect(conversation.state.events.map((event) => event.task)).toEqual([
			"alpha",
			"quiet",
		]);
		expect(deps.log.entries).toEqual([]);
	});

	it("hands it each new event as the journal takes it, and an external agent's to none", async () => {
		// Logged ahead of the last, so they are read by the time it is.
		await claimed("gamma", null);
		await claimed("delta", "some-other-conversation");
		await claimed("beta", conversation.id);

		await eventually(() => conversation.state.events.length === 2, 100);

		expect(conversation.state.events.map((event) => event.task)).toEqual([
			"alpha",
			"beta",
		]);
	});
});
