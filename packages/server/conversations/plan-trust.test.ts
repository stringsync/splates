import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { FakeFs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent, say } from "../agents/testing";
import { Conversations } from "./index";
import type { PlanTrusted } from "./state";
import { eventually, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };
const DIR = "/repo/.git/splates/conversations";
const PLAN =
	"## 📝 Plan: drag the sidebar\n\n**Goal:** Let the pages list resize.";

describe("A plan an agent went ahead on with trust", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-splates/login");
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-11-27T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(DIR, [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
		});
	});

	afterEach(() => conversations.disposeAsync());

	const turn = async (words: string, trusted: PlanTrusted | null) => {
		conversations.planTrust = async () => trusted;
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say(words) });
			return "end_turn";
		};
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.prompt("make the sidebar resize");
		await until(conversation, "idle");
		return conversation;
	};

	it("keeps the band and score on the turn that posted it, read back from the log", async () => {
		const conversation = await turn(`${PLAN}\n\nBuilding it now.`, {
			band: "ask-and-go",
			score: 78,
		});
		await eventually(
			() => conversation.state.messages.at(-1)?.trusted !== undefined,
		);

		expect(conversation.state.messages.at(-1)?.trusted).toEqual({
			band: "ask-and-go",
			score: 78,
		});

		await conversation.stop();
		const reread = new Conversations(DIR, [AGENT], {
			fs,
			timer,
			clock,
			launch: agent.launch,
		});
		const [read] = await reread.list();
		expect(read?.state.messages.at(-1)?.trusted).toEqual({
			band: "ask-and-go",
			score: 78,
		});
		await reread.disposeAsync();
	});

	it("keeps nothing below ask-and-go, where the plan waits for the person", async () => {
		const conversation = await turn(PLAN, null);
		await Bun.sleep(5);

		expect(conversation.state.messages.at(-1)?.trusted).toBeUndefined();
		expect(await fs.read(`${DIR}/${conversation.id}.jsonl`)).not.toContain(
			"plan-trust",
		);
	});

	it("keeps nothing for a turn that posted no plan", async () => {
		const conversation = await turn("Done.", { band: "assume", score: 95 });
		await Bun.sleep(5);

		expect(conversation.state.messages.at(-1)?.trusted).toBeUndefined();
	});
});
