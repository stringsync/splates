import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { eventually, once, until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { FakeAgent, heard, say } from "./fake-agent";

const OPENCODE = {
	id: "opencode",
	name: "OpenCode",
	argv: ["opencode", "acp"],
};
const MODEL = "opencode-go/test-model";
const OTHER = "other/test-model";

describe("OpenCode ACP fixtures (not a recorded executable handshake)", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let agent: FakeAgent;
	let conversations: Conversations;
	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo");
		timer = new FakeTimer();
		agent = new FakeAgent();
		agent.options = [
			{
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: OTHER,
				options: [
					{ value: MODEL, name: "Test" },
					{ value: OTHER, name: "Test" },
				],
			},
		];
		conversations = new Conversations("/logs", [OPENCODE], {
			fs,
			timer,
			launch: agent.launch,
		});
	});
	afterEach(() => conversations.disposeAsync());
	const start = (model = MODEL) =>
		conversations.start("opencode", { task: null, cwd: "/repo", model });
	const deathWait = async () => {
		await eventually(() =>
			timer.timeouts.some(
				(entry) => !entry.disposed && entry.delay.ms === 1000,
			),
		);
		const index = timer.timeouts.findIndex(
			(entry) => !entry.disposed && entry.delay.ms === 1000,
		);
		timer.fireTimeout(index);
	};
	const rejected = async (model: string) => {
		const conversation = await start(model);
		await eventually(() => conversation.state.settings.length > 0);
		await deathWait();
		await until(conversation, "failed");
		expect(agent.prompts).toEqual([]);
		return conversation;
	};

	it.each([true, false])(
		"keeps usage across restart and negotiated recovery (resume=%s)",
		async (resume) => {
			agent.resumes = resume;
			const usage = {
				sessionUpdate: "usage_update" as const,
				used: 10,
				size: 1000,
				cost: { amount: 2, currency: "USD" },
			};
			agent.held = [
				{
					sessionId: "s1",
					cwd: "/repo",
					replay: [heard("old"), usage, say("replayed text")],
				},
			];
			agent.usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };
			agent.turn = async (client, sessionId) => {
				await client.sessionUpdate({ sessionId, update: usage });
				await client.sessionUpdate({ sessionId, update: say("answer") });
				return "end_turn";
			};
			const conversation = await start();
			await until(conversation, "idle");
			await conversation.prompt("one");
			await until(conversation, "idle");
			await conversation.stop();
			const reread = new Conversations("/logs", [OPENCODE], {
				fs,
				timer,
				launch: agent.launch,
			});
			const read = await reread.find(conversation.id);
			await read.resume();
			expect(read.state.usage.opencode?.turns).toHaveLength(1);
			expect(read.state.usage.opencode?.turns[0]).toMatchObject({
				requested: MODEL,
				confirmed: MODEL,
				cwd: "/repo",
				tokens: { input: 10 },
			});
			expect(read.state.usage.opencode?.turns[0]?.until).not.toBeNull();
			expect(read.state.usage.cost?.amount).toBe(2);
			expect(JSON.stringify(read.state.messages)).not.toContain(
				"replayed text",
			);
			await read.choose("model", OTHER);
			agent.usage = null;
			await read.prompt("two");
			await until(read, "idle");
			expect(read.state.usage.opencode?.turns[1]).toMatchObject({
				requested: OTHER,
				confirmed: OTHER,
				tokens: null,
			});
			expect(read.state.usage.cost?.amount).toBe(2);
			await reread.disposeAsync();
		},
	);

	it("persists sanitized retry status, allows cancellation, and never substitutes providers", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					_meta: {
						"opencode/retry": {
							attempt: 1,
							error: {
								message: "Rate limit Bearer sensitive",
								response: { body: "private-body" },
							},
						},
					},
				},
			});
			await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "wait", title: "Wait" },
				options: [],
			});
			return "cancelled";
		};
		const conversation = await start();
		await until(conversation, "idle");
		await conversation.prompt("one");
		await once(conversation, () => conversation.state.ask !== null);
		expect(conversation.state.usage.opencode?.retry?.message).toContain(
			"Rate limit",
		);
		await conversation.saved();
		const reread = new Conversations("/logs", [OPENCODE], {
			fs,
			timer,
			launch: agent.launch,
		});
		const read = await reread.find(conversation.id);
		expect(JSON.stringify(read.state)).not.toContain("sensitive");
		expect(JSON.stringify(read.state)).not.toContain("private-body");
		await conversation.cancel();
		await until(conversation, "idle");
		expect(conversation.state.usage.opencode?.retry).toBeNull();
		expect(conversation.state.settings[0]?.current).toBe(MODEL);
		expect(conversation.state.usage.limits).toEqual([]);
		await reread.disposeAsync();
	});

	it.each([
		"Test",
		"test-model",
		"opencode-go/missing",
		"OpenCode-Go/test-model",
	])(
		"rejects unavailable or aliased model %s before prompting",
		async (model) => {
			const conversation = await rejected(model);
			expect(conversation.state.error).toContain("not offered");
		},
	);

	it("rejects a provider substitution and remembers the request on restart", async () => {
		agent.ignoreChoices = true;
		const conversation = await rejected(MODEL);
		expect(conversation.state.error).toContain("did not confirm");
		await conversation.saved();
		const reread = new Conversations("/logs", [OPENCODE], {
			fs,
			timer,
			launch: agent.launch,
		});
		const read = await reread.find(conversation.id);
		agent.ignoreChoices = false;
		await read.resume();
		expect(read.state.settings[0]?.current).toBe(MODEL);
		expect(agent.prompts).toEqual([]);
		await reread.disposeAsync();
	});

	it("streams tools and text, denies permission, and advertises no client file or terminal tools", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Checking.") });
			const answer = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "tool", title: "Run test", kind: "execute" },
				options: [{ optionId: "deny", name: "Deny", kind: "reject_once" }],
			});
			expect(answer.outcome).toEqual({ outcome: "selected", optionId: "deny" });
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tool",
					status: "failed",
				},
			});
			await client.sessionUpdate({ sessionId, update: say("Denied.") });
			return "end_turn";
		};
		const conversation = await start();
		await until(conversation, "idle");
		expect(agent.capabilities?.fs).toEqual({
			readTextFile: false,
			writeTextFile: false,
		});
		expect(agent.capabilities?.terminal).toBe(false);
		expect(agent.capabilities?.elicitation).toEqual({ form: {} });
		await conversation.prompt("test");
		await once(conversation, () => conversation.state.ask !== null);
		conversation.answer("tool", { type: "permission", option: "deny" });
		await until(conversation, "idle");
		expect(JSON.stringify(conversation.state.messages)).toContain("Denied.");
	});

	it("queues rather than steering or starting a second prompt and cancels a pending permission", async () => {
		agent.turn = async (client, sessionId) => {
			const answer = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "tool", title: "Run" },
				options: [],
			});
			expect(answer.outcome).toEqual({ outcome: "cancelled" });
			return "cancelled";
		};
		const conversation = await start();
		await until(conversation, "idle");
		await conversation.prompt("one");
		await once(conversation, () => conversation.state.ask !== null);
		await conversation.prompt("two");
		expect(agent.prompts).toHaveLength(1);
		expect(agent.steered).toEqual([]);
		await conversation.cancel();
		await until(conversation, "idle");
		expect(conversation.state.ask).toBeNull();
		expect(agent.cancelled).toBe(1);
		expect(agent.prompts).toHaveLength(1);
	});

	it("recovers with load only when advertised and suppresses history replay", async () => {
		agent.resumes = false;
		agent.held = [
			{
				sessionId: "s1",
				cwd: "/repo",
				replay: [heard("old"), say("old answer")],
			},
		];
		const conversation = await start();
		await until(conversation, "idle");
		await conversation.stop();
		await conversation.resume();
		expect(agent.loaded).toEqual(["s1"]);
		expect(agent.resumed).toEqual([]);
		expect(conversation.state.messages).toEqual([]);
		expect(conversation.state.settings[0]?.current).toBe(MODEL);
	});

	// scry-ignore simple-test-setup: moving and reopening are the persistence behavior exercised here.
	it("prefers negotiated resume and keeps original cwd after a task move and restart", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		conversation.move("task", "/different");
		await conversation.stop();
		const reread = new Conversations("/logs", [OPENCODE], {
			fs,
			timer,
			launch: agent.launch,
		});
		const read = await reread.find(conversation.id);
		await read.resume();
		expect(agent.resumed).toEqual(["s1"]);
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		expect(read.state.settings[0]?.current).toBe(MODEL);
		await reread.disposeAsync();
	});

	it("refuses unsupported recovery without creating a replacement session", async () => {
		agent.resumes = false;
		const conversation = await start();
		await until(conversation, "idle");
		await conversation.stop();
		const recovering = conversation.resume();
		await deathWait();
		await recovering;
		expect(conversation.state.error).toContain("neither resume nor load");
		expect(agent.opened).toHaveLength(1);
		expect(agent.prompts).toEqual([]);
	});

	it("explains when a moved session's original directory is gone", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		await fs.mkdir("/different");
		conversation.move(null, "/different");
		await conversation.stop();
		await fs.rm("/repo", { recursive: true });
		await conversation.resume();
		expect(conversation.state.error).toContain(
			"original directory /repo is unavailable",
		);
		expect(agent.launched).toHaveLength(1);
	});

	it("blocks a prompt after settings change to a different provider", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		await agent.say({
			sessionUpdate: "config_option_update",
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: OTHER,
					options: [{ value: OTHER, name: "Test" }],
				},
			],
		});
		await once(
			conversation,
			() => conversation.state.settings[0]?.current === OTHER,
		);
		await conversation.prompt("do not send");
		await once(conversation, () => conversation.state.error !== null);
		expect(agent.prompts).toEqual([]);
		expect(conversation.state.error).toContain("not confirmed");
	});

	it("fails a live model change when the agent does not confirm it", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		agent.ignoreChoices = true;
		await expect(conversation.choose("model", OTHER)).rejects.toThrow(
			"did not confirm",
		);
		expect(conversation.state.status).toBe("failed");
		expect(agent.prompts).toEqual([]);
	});

	it("supports forms without requiring optional extensions", async () => {
		agent.turn = async (client, sessionId) => {
			const answer = await client.createElicitation({
				sessionId,
				mode: "form",
				message: "Which?",
				requestedSchema: {
					type: "object",
					properties: { choice: { type: "string" } },
					required: ["choice"],
				},
			});
			expect(answer).toMatchObject({
				action: "accept",
				content: { choice: "fixture" },
			});
			return "end_turn";
		};
		const conversation = await start();
		await until(conversation, "idle");
		await conversation.prompt("ask");
		await once(conversation, () => conversation.state.ask !== null);
		conversation.answer(conversation.state.ask?.id ?? "", {
			type: "question",
			values: { choice: "fixture" },
		});
		await until(conversation, "idle");
	});

	it("reports a disconnected process and resumes the same session on an explicit retry", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		agent.crash();
		await until(conversation, "failed");
		await conversation.resume();
		expect(agent.resumed).toEqual(["s1"]);
		expect(conversation.state.settings[0]?.current).toBe(MODEL);
	});

	it("rejects an incompatible protocol version before opening a session", async () => {
		agent.protocolVersion = 999;
		const conversation = await start();
		await deathWait();
		await until(conversation, "failed");
		expect(conversation.state.error).toContain(
			"Unsupported ACP protocol version 999",
		);
		expect(agent.opened).toEqual([]);
		expect(agent.prompts).toEqual([]);
	});

	it("fails on a protocol disconnect even if the process stays alive", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		agent.disconnect();
		await until(conversation, "failed");
		expect(conversation.state.error).toContain("ACP connection closed");
		expect(agent.killed).toBe(1);
	});

	it("reports missing authentication with sanitized stderr and sends no prompt", async () => {
		agent.dying = 1;
		agent.stderr =
			"Login required: api_key=fixture-secret Authorization: Bearer fixture-token";
		const conversation = await start();
		await until(conversation, "failed");
		expect(conversation.state.error).toContain("Login required");
		expect(conversation.state.error).not.toContain("fixture-secret");
		expect(conversation.state.error).not.toContain("fixture-token");
		expect(agent.prompts).toEqual([]);
	});
});
