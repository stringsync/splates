import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AGENT, FakeAgent } from "../agents/testing";
import { Testing } from "../testing";
import type { Conversation } from "./conversation";
import { Conversations } from "./conversations";
import { JournalEvents } from "./events";
import { eventually } from "./testing";

describe("conversation events", () => {
	let deps: Testing;
	let conversations: Conversations;
	let conversation: Conversation;
	let following: JournalEvents;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
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
		// The OS takes a moment to start a watch, and drops what is written in
		// that moment, so the test writes nothing it counts until one has fired.
		let heard = 0;
		const fs = Object.create(deps.fs) as Testing["fs"];
		fs.watch = (path, onChange, opts) =>
			deps.fs.watch(
				path,
				(changed) => {
					heard++;
					onChange(changed);
				},
				opts,
			);
		following = await JournalEvents.follow({
			journal: deps.journal,
			conversations,
			fs,
			splatesDir: deps.splatesDir,
			log: deps.log,
		});
		for (let i = 0; i < 500 && heard === 0; i++) {
			await claimed("primer", null);
			await Bun.sleep(10);
		}
		expect(heard).toBeGreaterThan(0);
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
			async () => ({ escalated: false, tookOver: false, goal: "" }),
			(out) => out,
		);
		delete deps.proc.env.SPLATES_CONVERSATION;
	};

	it("hands a conversation the events its agent logged before the server opened", () => {
		expect(conversation.state.events).toMatchObject([
			{ action: "claim", task: "alpha", conversation: conversation.id },
		]);
	});

	it("logs new events once with a trailing newline, without replaying history", async () => {
		expect(
			deps.log.entries.some((entry) =>
				String(entry.message).includes('"task":"alpha"'),
			),
		).toBe(false);
		await claimed("logged", null);
		await eventually(
			() =>
				deps.log.entries.some((entry) =>
					String(entry.message).includes('"task":"logged"'),
				),
			100,
		);
		await following.changed();
		const entries = deps.log.entries.filter((entry) =>
			String(entry.message).includes('"task":"logged"'),
		);
		expect(entries).toHaveLength(1);
		expect(String(entries[0]?.message).endsWith("\n")).toBe(true);
		expect(JSON.parse(String(entries[0]?.message))).toMatchObject({
			action: "claim",
			task: "logged",
		});
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
