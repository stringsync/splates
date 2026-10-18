import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "./index";
import { eventually, until } from "./testing";

describe("Messages to a stopped conversation", () => {
	let agent: FakeAgent;
	let conversations: Conversations;
	let conversation: Conversation;

	beforeEach(async () => {
		const fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/login"]) {
			await fs.mkdir(tree);
		}
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer: new FakeTimer(),
				clock: new FakeWallClock(Date.parse("2026-10-11T10:00:00Z")),
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
		conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.stop();
	});

	afterEach(() => conversations.disposeAsync());

	it("records a message as queued while its agent resumes", async () => {
		let open!: () => void;
		agent.hold = new Promise<void>((resolve) => (open = resolve));

		const sending = conversation.prompt("carry on", [], undefined, {
			id: "m1",
		});

		await eventually(() =>
			conversation.state.messages.some(
				(each) => each.id === "m1" && each.queued,
			),
		);
		expect(conversation.state.status).toBe("starting");
		open();
		await sending;
		await until(conversation, "running");
		expect(
			conversation.state.messages.find((each) => each.id === "m1")?.queued,
		).toBeFalsy();
	});

	it("takes the message back when the resume is refused", async () => {
		(conversation as unknown as { dir: string | null }).dir = null;

		await expect(conversation.prompt("carry on")).rejects.toThrow();

		expect(conversation.state.messages.some((each) => each.queued)).toBe(false);
	});
});
