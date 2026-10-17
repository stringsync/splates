import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { once, until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("Conversation asks", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		// The trees the agents run in, which a resume looks for.
		for (const tree of ["/repo", "/repo-arbor/login", "/repo-arbor/signup"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
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

	it("holds a permission request until the person picks an option", async () => {
		const seen: { outcome?: acp.RequestPermissionOutcome } = {};
		agent.turn = async (client, sessionId) => {
			({ outcome: seen.outcome } = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "rm -rf build" },
				options: [
					{ optionId: "yes", name: "Allow", kind: "allow_once" },
					{ optionId: "no", name: "Reject", kind: "reject_once" },
				],
			}));
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("clean up");
		await once(conversation, () => conversation.state.ask !== null);

		expect(conversation.state.ask).toEqual({
			type: "permission",
			id: "t1",
			at: expect.any(String),
			title: "rm -rf build",
			options: [
				{ id: "yes", name: "Allow", kind: "allow_once" },
				{ id: "no", name: "Reject", kind: "reject_once" },
			],
		});
		conversation.answer("t1", { type: "permission", option: "no" });
		await until(conversation, "idle");

		expect(conversation.state.ask).toBeNull();
		expect(seen.outcome).toEqual({ outcome: "selected", optionId: "no" });
	});

	it("reuses a streamed tool title when approval omits it and keeps approval details", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "mcp.cua_repl.js",
					kind: "execute",
				},
			});
			await client.requestPermission({
				sessionId,
				toolCall: {
					toolCallId: "t1",
					rawInput: { command: "select Chrome" },
				},
				options: [{ optionId: "no", name: "Reject", kind: "reject_once" }],
			});
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("review the fixture");
		await once(conversation, () => conversation.state.ask !== null);
		expect(conversation.state.ask).toMatchObject({ title: "mcp.cua_repl.js" });
		const tools = () =>
			conversation.state.messages.flatMap((message) =>
				message.parts.filter((part) => part.type === "tool"),
			);
		expect(tools()).toMatchObject([
			{ title: "mcp.cua_repl.js", command: "select Chrome", kind: "execute" },
		]);
		conversation.answer("t1", { type: "permission", option: "no" });
		await until(conversation, "idle");
	});

	it("keeps how a permission was answered on its tool call, and in the log", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "rm -rf build",
					kind: "execute",
				},
			});
			await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "rm -rf build" },
				options: [
					{ optionId: "yes", name: "Allow", kind: "allow_once" },
					{ optionId: "no", name: "Reject", kind: "reject_once" },
				],
			});
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("clean up");
		await once(conversation, () => conversation.state.ask !== null);
		conversation.answer("t1", { type: "permission", option: "yes" });
		await until(conversation, "idle");
		const decisions = (each: Conversation) =>
			each.state.messages.flatMap((message) =>
				message.parts.flatMap((part) =>
					part.type === "tool" ? [[part.title, part.decision?.option]] : [],
				),
			);

		expect(decisions(conversation)).toEqual([
			["rm -rf build", { name: "Allow", kind: "allow_once" }],
		]);
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read && decisions(read)).toEqual([
			["rm -rf build", { name: "Allow", kind: "allow_once" }],
		]);
		await reread.disposeAsync();
	});

	// scry-ignore simple-test-setup: the elicitation payload belongs only to this question-form test.
	it("asks the person an agent's question form and hands back the answer", async () => {
		const seen: { response?: acp.CreateElicitationResponse } = {};
		agent.turn = async (client, sessionId) => {
			seen.response = await client.createElicitation({
				sessionId,
				mode: "form",
				message: "Uppercase the note?",
				requestedSchema: {
					type: "object",
					properties: {
						question_0: {
							type: "string",
							title: "Uppercase",
							oneOf: [
								{ const: "yes", title: "Yes", description: "Shout it" },
								{ const: "no", title: "No" },
							],
						},
						question_0_custom: {
							type: "string",
							title: "Other",
							description: "Your own answer",
						},
					},
				},
			} as acp.CreateElicitationRequest);
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("tidy the note");
		await once(conversation, () => conversation.state.ask !== null);
		const ask = conversation.state.ask;

		expect(ask).toMatchObject({
			type: "question",
			message: "Uppercase the note?",
			fields: [
				{
					key: "question_0",
					title: "Uppercase",
					description: null,
					choices: [
						{ value: "yes", title: "Yes", description: "Shout it" },
						{ value: "no", title: "No", description: null },
					],
				},
				{
					key: "question_0_custom",
					title: "Other",
					description: "Your own answer",
					choices: null,
				},
			],
		});
		conversation.answer(ask?.id ?? "", {
			type: "question",
			values: { question_0: "yes" },
		});
		await until(conversation, "idle");

		expect(seen.response).toEqual({
			action: "accept",
			content: { question_0: "yes" },
		});
	});

	it("cancels a turn, dismissing what it was asking", async () => {
		const seen: { outcome?: acp.RequestPermissionOutcome } = {};
		agent.turn = async (client, sessionId) => {
			({ outcome: seen.outcome } = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "deploy" },
				options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
			}));
			return "cancelled";
		};
		const conversation = await started();
		await conversation.prompt("ship it");
		await once(conversation, () => conversation.state.ask !== null);

		await conversation.cancel();
		await until(conversation, "idle");

		expect(agent.cancelled).toBe(1);
		expect(seen.outcome).toEqual({ outcome: "cancelled" });
		expect(conversation.state.ask).toBeNull();
		// Asked before the agent said it was making the call, which shows anyway.
		expect(conversation.state.messages[1]?.parts).toMatchObject([
			{ type: "tool", title: "deploy", decision: { option: null } },
		]);
	});
});
