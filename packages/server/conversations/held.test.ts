import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { FakeAgent } from "../agents/testing";
import { Conversations } from "./index";
import { eventually, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("A conversation held for a queued task", () => {
	let fs: FakeFs;
	let agent: FakeAgent;
	let conversations: Conversations;

	const open = () =>
		new Conversations("/repo/.git/splates/conversations", [AGENT], {
			fs,
			timer: new FakeTimer(),
			clock: new FakeWallClock(Date.parse("2026-10-19T12:00:00Z")),
			ids: new CounterIdProvider(),
			launch: agent.launch,
		});

	beforeEach(async () => {
		fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/totals"]) {
			await fs.mkdir(tree);
		}
		agent = new FakeAgent();
		agent.turn = async () => "end_turn";
		conversations = open();
	});

	afterEach(() => conversations.disposeAsync());

	/** Holds one for queued task 7, as the queue does. */
	const held = () =>
		conversations.start("fake", {
			task: null,
			cwd: "/repo",
			assigned: true,
			capped: true,
			queued: 7,
			title: "#7 Totals first",
		});

	it("waits, named for its task, with no agent until the queue gives it the task", async () => {
		const conversation = await held();
		conversation.waitsAt({
			position: 2,
			of: 3,
			since: "2026-10-19T12:00:00.000Z",
			reason: "waits on #6",
		});
		await Bun.sleep(0);

		expect(conversation.held).toBe(true);
		expect(conversation.state).toMatchObject({
			status: "starting",
			queued: 7,
			title: "#7 Totals first",
			queue: { position: 2, reason: "waits on #6" },
		});
		expect(agent.launched).toEqual([]);
	});

	it("opens its agent in the task's tree once released, saying first what was said to it meanwhile", async () => {
		const conversation = await held();
		const said = conversation.prompt("mind the rounding");
		await eventually(() => conversation.state.messages.length > 0);
		expect(conversation.state.messages[0]?.queued).toBe(true);

		conversation.release("totals", "/repo-splates/totals");
		await said;
		await until(conversation, "idle");

		expect(conversation.held).toBe(false);
		expect(conversation.state).toMatchObject({
			task: "totals",
			queued: null,
			queue: null,
		});
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/repo-splates/totals",
		]);
		expect(conversation.state.messages[0]?.queued).toBeUndefined();
	});

	it("stops without opening its agent, and reads back stopped, to be held again", async () => {
		const conversation = await held();
		await conversation.stop();
		expect(conversation.state.status).toBe("stopped");
		expect(agent.launched).toEqual([]);

		await conversations.disposeAsync();
		conversations = open();
		const read = await conversations.find(conversation.id);
		expect(read.state).toMatchObject({
			status: "stopped",
			queued: 7,
			title: "#7 Totals first",
		});

		read.hold();
		expect(read.state.status).toBe("starting");
		read.release("totals", "/repo-splates/totals");
		await until(read, "idle");
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/repo-splates/totals",
		]);
	});
});
