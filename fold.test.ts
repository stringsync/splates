import { describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { type ConversationState, unused } from "./conversation-state";
import { fold } from "./fold";

describe("fold", () => {
	const state = (): ConversationState => ({
		id: "c",
		agent: "claude",
		task: null,
		lastTask: null,
		lastBase: null,
		lastCaller: null,
		title: null,
		name: null,
		status: "running",
		error: null,
		messages: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: "2026-10-11T10:00:00.000Z",
		archived: false,
		archivedWith: null,
		handedBy: null,
		assigned: false,
		unread: false,
		seen: 0,
		checkpoint: null,
		usage: unused(),
		background: [],
	});
	const at = (secs: number) =>
		new Date(Date.parse("2026-10-11T10:00:00Z") + secs * 1000).toISOString();
	/** Folds each update into `into` in order, each at the time beside it. */
	const foldAll = (
		into: ConversationState,
		updates: [acp.SessionUpdate, string][],
	) => {
		for (const [update, when] of updates) {
			fold(into, update, when);
		}
	};

	it("keeps how full the context is, but not a subagent's", () => {
		const into = state();

		fold(into, { sessionUpdate: "usage_update", used: 10, size: 100 });
		fold(into, {
			sessionUpdate: "usage_update",
			used: 90,
			size: 100,
			_meta: { claudeCode: { parentToolUseId: "t1" } },
		});

		expect(into.usage).toEqual({
			...unused(),
			context: { used: 10, size: 100 },
		});
	});

	it("keeps each window of the plan Claude says, from any turn", () => {
		const into = state();
		const limited = (info: object, parent?: string): acp.SessionUpdate => ({
			sessionUpdate: "usage_update",
			used: 10,
			size: 100,
			_meta: {
				"_claude/rateLimit": info,
				...(parent === undefined
					? {}
					: { claudeCode: { parentToolUseId: parent } }),
			},
		});

		fold(
			into,
			limited({
				status: "allowed",
				unifiedWindows: {
					five_hour: { utilization: 0.42, resetsAt: 1_791_730_800 },
					seven_day: { utilization: 0.18, resetsAt: 1_792_000_000 },
				},
			}),
			at(0),
		);
		// Older CLIs name one window; a subagent's turn uses the same plan.
		fold(
			into,
			limited(
				{
					status: "allowed_warning",
					rateLimitType: "five_hour",
					utilization: 0.85,
					resetsAt: 1_791_730_800,
				},
				"t1",
			),
			at(60),
		);
		fold(into, limited({ status: "allowed" }), at(120));

		expect(into.usage.limits).toEqual([
			{
				window: "seven_day",
				used: 0.18,
				resets: "2026-10-14T17:46:40.000Z",
				at: at(0),
			},
			{
				window: "five_hour",
				used: 0.85,
				resets: "2026-10-11T15:00:00.000Z",
				at: at(60),
			},
		]);
	});

	it("keeps the skills and commands the agent last said it has", () => {
		const into = state();

		fold(into, {
			sessionUpdate: "available_commands_update",
			availableCommands: [{ name: "init", description: "Write a CLAUDE.md" }],
		});
		fold(into, {
			sessionUpdate: "available_commands_update",
			availableCommands: [
				{ name: "arbor", description: "Land work on trunk" },
				{
					name: "code-review",
					description: "Review the diff",
					input: { hint: "low|medium|high" },
				},
			],
		});

		expect(into.commands).toEqual([
			{ name: "arbor", description: "Land work on trunk", hint: null },
			{
				name: "code-review",
				description: "Review the diff",
				hint: "low|medium|high",
			},
		]);
	});

	it("keeps a command, its output, and how long it ran, as Claude sends them", () => {
		const into = state();
		const updates: acp.SessionUpdate[] = [
			{
				sessionUpdate: "tool_call",
				toolCallId: "t1",
				title: "Terminal",
				kind: "execute",
				status: "pending",
				content: [],
				rawInput: {},
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				title: "bun test",
				rawInput: { command: "bun test" },
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				content: [
					{ type: "content", content: { type: "text", text: "Run the tests" } },
				],
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				status: "failed",
				content: [
					{
						type: "content",
						content: { type: "text", text: "```console\n1 fail\n```" },
					},
				],
			},
		];
		foldAll(
			into,
			updates.map((update, index) => [update, at(index * 10)]),
		);

		expect(into.messages[0]?.parts).toEqual([
			{
				type: "tool",
				id: "t1",
				title: "bun test",
				status: "failed",
				kind: "execute",
				command: "bun test",
				target: null,
				output: "1 fail",
				edits: [],
				paths: [],
				parent: null,
				at: at(0),
				until: at(30),
				flags: [],
				decision: null,
			},
		]);
		expect(into.messages[0]).toMatchObject({ at: at(0), until: at(30) });
	});

	it("streams a command's output and fails it on a nonzero exit, as Codex sends them", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "x1",
			title: "wc -l note.txt",
			kind: "execute",
			status: "in_progress",
			rawInput: { command: ["wc", "-l", "note.txt"] },
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "x1",
			_meta: { terminal_output_delta: { data: "no such file\n" } },
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "x1",
			status: "completed",
			_meta: { terminal_exit: { exit_code: 1 } },
		});

		expect(into.messages[0]?.parts[0]).toMatchObject({
			command: "wc -l note.txt",
			output: "no such file\n",
			status: "failed",
		});
	});

	it("keeps what a call searches for or fetches, as its input names it", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g1",
			title: "grep",
			kind: "search",
			rawInput: { pattern: "fold\\(" },
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "f1",
			title: "Fetch",
			kind: "fetch",
			rawInput: { url: "https://example.com" },
		});

		expect(
			into.messages[0]?.parts.map((part) =>
				part.type === "tool" ? part.target : null,
			),
		).toEqual(["fold\\(", "https://example.com"]);
	});

	it("keeps an edit's file and its change", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "w1",
			title: "Write note.txt",
			kind: "edit",
			locations: [{ path: "/repo/note.txt" }],
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "w1",
			status: "completed",
			content: [
				{ type: "diff", path: "/repo/note.txt", oldText: "hi", newText: "HI" },
			],
		});

		expect(into.messages[0]?.parts[0]).toMatchObject({
			paths: ["/repo/note.txt"],
			edits: [{ path: "/repo/note.txt", old: "hi", new: "HI" }],
		});
	});

	it("files a subagent's tool calls under its own, and leaves out its words", () => {
		const into = state();
		const under = { claudeCode: { parentToolUseId: "a1" } };
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "a1",
			title: "Find the callers",
			kind: "think",
		});
		fold(into, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Searching." },
			_meta: under,
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g1",
			title: "grep fold",
			kind: "search",
			_meta: under,
		});

		expect(
			into.messages[0]?.parts.map((part) =>
				part.type === "tool" ? [part.id, part.parent] : part.type,
			),
		).toEqual([
			["a1", null],
			["g1", "a1"],
		]);
	});

	it("files a subagent's calls under its own after the agent replied, and in a later turn", () => {
		const into = state();
		const under = { claudeCode: { parentToolUseId: "a1" } };
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "a1",
			title: "Find the callers",
			kind: "think",
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g1",
			title: "grep fold",
			kind: "search",
			_meta: under,
		});
		fold(into, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Started it." },
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g2",
			title: "grep agentTurn",
			kind: "search",
			_meta: under,
		});
		into.messages.push({
			role: "user",
			parts: [{ type: "text", text: "Anything yet?" }],
			plan: null,
			at: null,
			until: null,
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "r1",
			title: "Read conversations.ts",
			kind: "read",
			_meta: under,
		});

		expect(
			into.messages.map((message) =>
				message.parts.map((part) =>
					part.type === "tool" ? part.id : part.type,
				),
			),
		).toEqual([["a1", "g1", "g2", "r1", "text"], ["text"]]);
	});

	it("keeps when the agent began saying something, not when it went on", () => {
		const into = state();
		foldAll(into, [
			[
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Now " },
				},
				at(0),
			],
			[
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "the fix." },
				},
				at(3),
			],
		]);

		expect(into.messages[0]?.parts).toEqual([
			{ type: "text", text: "Now the fix.", at: at(0) },
		]);
	});

	it("keeps the plan as last sent, and when a thought began", () => {
		const into = state();
		fold(
			into,
			{
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "Hmm" },
			},
			at(0),
		);
		fold(
			into,
			{
				sessionUpdate: "plan",
				entries: [
					{ content: "Read", priority: "high", status: "completed" },
					{ content: "Write", priority: "high", status: "in_progress" },
				],
			},
			at(5),
		);

		expect(into.messages[0]).toMatchObject({
			parts: [{ type: "thought", text: "Hmm", at: at(0) }],
			plan: [
				{ text: "Read", status: "completed" },
				{ text: "Write", status: "in_progress" },
			],
			until: at(5),
		});
	});
});
