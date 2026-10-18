import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import type { Agent } from "../agent-process";
import { AGENT, FakeAgent } from "../fake-agent";
import type { Picked } from "./conversation";
import { Conversations } from "./index";
import { eventually, until } from "./testing";

/** A second agent for Auto to pick over the one it starts on. */
const OTHER: Agent = { id: "other", name: "Other", argv: ["other-acp"] };

describe("A conversation Auto is picking for", () => {
	let fs: FakeFs;
	let agent: FakeAgent;
	let conversations: Conversations;
	let pick: (picked: Picked<string>) => void;
	let refuse: (error: Error) => void;
	let picking: Promise<Picked<string>>;

	const open = () =>
		new Conversations("/repo/.git/splates/conversations", [AGENT, OTHER], {
			fs,
			timer: new FakeTimer(),
			clock: new FakeWallClock(Date.parse("2026-10-11T10:00:00Z")),
			ids: new CounterIdProvider(),
			launch: agent.launch,
		});
	const start = () =>
		conversations.start("fake", {
			task: null,
			cwd: "/repo",
			assigned: true,
			auto: true,
			picking,
		});

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo");
		agent = new FakeAgent();
		conversations = open();
		picking = new Promise((resolve, reject) => {
			pick = resolve;
			refuse = reject;
		});
	});

	afterEach(() => conversations.disposeAsync());

	it("opens no agent, and holds a message as queued, until Auto picks", async () => {
		const conversation = await start();
		expect(conversation.state).toMatchObject({
			status: "starting",
			picking: true,
		});

		const sending = conversation.prompt("fix the login", [], undefined, {
			id: "m1",
		});
		await eventually(() =>
			conversation.state.messages.some(
				(each) => each.id === "m1" && each.queued,
			),
		);
		expect(agent.launched).toEqual([]);

		pick({ agent: "other", model: "small", settings: {} });
		await sending;
		await eventually(() => agent.prompts.length === 1);
		expect(agent.launched.map((each) => each.argv)).toEqual([["other-acp"]]);
		expect(conversation.state).toMatchObject({
			agent: "other",
			picking: false,
		});
		expect(conversation.agent).toBe(OTHER);
		expect(agent.chosen).toContainEqual({ configId: "model", value: "small" });
	});

	it("opens on what it started on when the pick fails", async () => {
		const conversation = await start();

		refuse(new Error("no roster"));
		await until(conversation, "idle");

		expect(agent.launched.map((each) => each.argv)).toEqual([["fake-acp"]]);
		expect(conversation.state).toMatchObject({
			agent: "fake",
			picking: false,
		});
	});

	it("opens nothing once it was stopped while Auto picked", async () => {
		const conversation = await start();

		await conversation.stop();
		pick({ agent: "other", settings: {} });
		await eventually(() => !conversation.state.picking);

		expect(conversation.state.status).toBe("stopped");
		expect(agent.launched).toEqual([]);
	});

	it("reads back on the agent Auto picked", async () => {
		const conversation = await start();
		pick({ agent: "other", settings: {} });
		await until(conversation, "idle");
		await conversations.disposeAsync();

		conversations = open();
		const read = await conversations.find(conversation.id);
		expect(read.state.agent).toBe("other");
		expect(read.agent).toBe(OTHER);
	});
});
