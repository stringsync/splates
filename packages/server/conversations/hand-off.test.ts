import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { FakeAgent } from "../agents/testing";
import { type Conversation, Conversations, SERVER_TOLD } from "./index";
import { until } from "./testing";

const DIR = "/repo/.git/splates/conversations";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("Restarting a conversation's agent, or handing its task off", () => {
	let fs: FakeFs;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/login"]) {
			await fs.mkdir(tree);
		}
		agent = new FakeAgent();
		conversations = new Conversations(DIR, [AGENT], {
			fs,
			timer: new FakeTimer(),
			clock: new FakeWallClock(Date.parse("2026-10-19T10:00:00Z")),
			ids: new CounterIdProvider(),
			launch: agent.launch,
			root: "/repo",
		});
	});

	afterEach(() => conversations.disposeAsync());

	const said = (blocks: { type: string; text?: string }[] | undefined) =>
		(blocks ?? []).flatMap((each) =>
			each.text === undefined ? [] : [each.text],
		);

	const working = async (): Promise<Conversation> => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.prompt("Fix the login");
		await until(conversation, "idle");
		return conversation;
	};

	it("restarts the agent in a new session on its task, told to claim it and where the old one's last turns are", async () => {
		const conversation = await working();
		const before = agent.launched.length;

		await conversation.restart();
		await until(conversation, "idle");

		expect(agent.launched.length).toBe(before + 1);
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-splates/login");
		expect(agent.resumed).toEqual([]);
		const transcript = `${DIR}/${conversation.id}/transcript.md`;
		expect(said(agent.prompts.at(-1)).join("\n")).toContain(
			`[SPLATES TASK login]\n\nThe agent before you on this task stopped without handing it over, so its SPLATES.md may be behind. What it said and did last is in ${transcript}`,
		);
		expect(await fs.read(transcript)).toContain("## Person\n\nFix the login");
		const told = conversation.state.messages.find((each) =>
			each.parts.some(
				(part) => part.type === "text" && part.text.startsWith("[SPLATES TASK"),
			),
		);
		expect(told?.told).toBe(SERVER_TOLD);
		expect(conversation.state.task).toBe("login");
	});

	it("hands its task off: stops the agent, moves it to the main tree, and answers the prompt for the next one", async () => {
		const conversation = await working();

		const prompt = await conversation.handOff();

		expect(conversation.state.status).toBe("stopped");
		expect(conversation.state.task).toBeNull();
		expect(conversation.state.lastTask).toBe("login");
		expect(prompt).toStartWith("[SPLATES TASK login]\n\n");
		expect(prompt).toContain(`${DIR}/${conversation.id}/transcript.md`);
	});

	it("refuses either for a conversation in no task", async () => {
		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
		});
		await until(conversation, "idle");

		await expect(conversation.restart()).rejects.toThrow(/in no task/);
		await expect(conversation.handOff()).rejects.toThrow(/in no task/);
	});
});
