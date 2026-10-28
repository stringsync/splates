import { describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { FakeTimer } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { compacted } from "./compact";
import { ConversationLog, type Entry } from "./log";

describe("compacted", () => {
	it("joins a tool call's streamed input into its last update", async () => {
		const entries = [
			START,
			update(TOOL, "09"),
			...['{"path":"', '{"path":"/a', '{"path":"/a.ts"}'].map((text, at) =>
				update(input(text), `1${at}`),
			),
			update({ ...input("done"), status: "completed", rawOutput: "ok" }, "20"),
		];

		const short = compacted(entries);

		expect(short).toHaveLength(3);
		const [turn] = (await replayed(short))?.messages ?? [];
		expect(turn?.until).toBe(`${DAY}20.000Z`);
		expect(turn?.parts).toMatchObject([
			{
				type: "tool",
				status: "completed",
				output: "ok",
				until: `${DAY}20.000Z`,
			},
		]);
	});

	it("joins a thought's chunks, starting when the first came and running until the last", async () => {
		const entries = [
			START,
			...["Let", " me", " look"].map((text, at) =>
				update(
					{
						sessionUpdate: "agent_thought_chunk",
						content: { type: "text", text },
					},
					`1${at}`,
				),
			),
			{ kind: "turn", running: false } as const,
		];

		const short = compacted(entries);

		expect(short).toHaveLength(3);
		const [turn] = (await replayed(short))?.messages ?? [];
		expect(turn?.at).toBe(`${DAY}10.000Z`);
		expect(turn?.until).toBe(`${DAY}12.000Z`);
		expect(turn?.parts).toEqual([
			{ type: "thought", text: "Let me look", at: `${DAY}10.000Z` },
		]);
	});

	it("joins parallel tool calls' interleaved updates, replaying the same", async () => {
		const other = (status: "in_progress" | "completed"): acp.SessionUpdate => ({
			...input("b"),
			toolCallId: "t2",
			status,
		});
		const entries = [
			START,
			update(TOOL, "09"),
			update({ ...TOOL, toolCallId: "t2" } as acp.SessionUpdate, "09"),
			update(input("a"), "10"),
			update(other("in_progress"), "11"),
			update(input("ab"), "12"),
			update(other("in_progress"), "13"),
			update({ ...input("abc"), status: "completed" }, "14"),
			update(other("completed"), "15"),
		];

		const short = compacted(entries);

		expect(short).toHaveLength(5);
		expect(await replayed(short)).toEqual(await replayed(entries));
	});

	it("keeps a tool call's updates apart across anything but other calls' updates", () => {
		const entries = [
			update(input("a"), "10"),
			update(
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hi" },
				},
				"11",
			),
			update(input("ab"), "12"),
		];

		expect(compacted(entries)).toEqual(entries);
	});

	it.each([
		[
			"an update after the tool call ended",
			{ status: "completed" },
			{ status: "completed" },
		],
		[
			"terminal output, which adds up",
			{ _meta: { terminal_output_delta: { data: "a" } } },
			{ _meta: { terminal_output_delta: { data: "b" } } },
		],
		[
			"an edit, whose path stays with the call",
			{ content: [{ type: "diff", path: "/a", newText: "x" }] },
			{ content: [{ type: "diff", path: "/b", newText: "y" }] },
		],
		[
			"a command a later input leaves out",
			{ rawInput: { command: "ls" } },
			{ rawInput: { description: "list" } },
		],
	] as const)("keeps apart updates with %s", (_, first, then) => {
		const entries = [
			update({ ...input("a"), ...first } as acp.SessionUpdate, "10"),
			update({ ...input("b"), ...then } as acp.SessionUpdate, "11"),
		];

		expect(compacted(entries)).toEqual(entries);
	});

	it("keeps apart chunks of different messages", () => {
		const entries = ["m1", "m2"].map((messageId, at) =>
			update(
				{
					sessionUpdate: "agent_message_chunk",
					messageId,
					content: { type: "text", text: "Hi" },
				},
				`1${at}`,
			),
		);

		expect(compacted(entries)).toEqual(entries);
	});

	it("rewrites a long log short as it is read back, saying the same", async () => {
		const storage = new MemoryStorage();
		const entries = [
			START,
			update(TOOL, "09"),
			...Array.from({ length: 1100 }, (_, at) =>
				update(input("x".repeat(at)), "10"),
			),
		];
		await storage.log<Entry>("1.jsonl").append(...entries);

		const read = await replayedFrom(storage);

		expect(await storage.log<Entry>("1.jsonl").replay()).toHaveLength(3);
		expect(await replayedFrom(storage)).toEqual(read);
	});
});

const START: Entry = {
	kind: "start",
	id: "1",
	agent: "fake",
	task: null,
	createdAt: "2026-10-19T00:00:00.000Z",
};

const TOOL: acp.SessionUpdate = {
	sessionUpdate: "tool_call",
	toolCallId: "t1",
	title: "Write",
	kind: "edit",
	status: "pending",
};

function input(
	text: string,
): Extract<acp.SessionUpdate, { sessionUpdate: "tool_call_update" }> {
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: "t1",
		status: "in_progress",
		content: [{ type: "content", content: { type: "text", text } }],
	};
}

const DAY = "2026-10-19T00:00:";

function update(update: acp.SessionUpdate, second: string): Entry {
	return { kind: "update", update, at: `${DAY}${second}.000Z` };
}

async function replayed(entries: Entry[]) {
	const storage = new MemoryStorage();
	await storage.log<Entry>("1.jsonl").append(...entries);
	return replayedFrom(storage);
}

async function replayedFrom(storage: MemoryStorage) {
	return (
		await new ConversationLog(
			storage.log<Entry>("1.jsonl"),
			new FakeTimer(),
		).replay()
	)?.state;
}
