import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

const BROWSER: acp.McpServer = {
	type: "http",
	name: "playwright",
	url: "http://localhost:51234/mcp",
	headers: [],
};

describe("Conversation servers", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let asked: number;
	let conversations: Conversations;

	const made = () =>
		new Conversations("/repo/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			servers: {
				servers: async () => {
					asked++;
					return [BROWSER];
				},
			},
		});

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-16T10:00:00Z"));
		agent = new FakeAgent();
		asked = 0;
		conversations = made();
	});

	afterEach(() => conversations.disposeAsync());

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	it("offers the shared servers to a session it opens and to one it resumes", async () => {
		agent.http = true;
		const conversation = await started();
		await conversation.stop();

		const [read] = await made().list();
		await read?.prompt("again");
		await until(read as Conversation, "idle");

		expect(agent.resumed).toEqual(["s1"]);
		expect(agent.mcp).toEqual([[BROWSER], [BROWSER]]);
	});

	it("offers none to an agent that takes no MCP server over HTTP, nor starts them", async () => {
		await started();

		expect(agent.mcp).toEqual([[]]);
		expect(asked).toBe(0);
	});
});
