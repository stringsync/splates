import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { ConversationLog } from "./conversation-log";
import { blank } from "./conversation-state";
import { fold, tally } from "./fold";
import {
	finishObservation,
	type ObservedTurn,
	safeOpenCodeUpdate,
} from "./opencode-usage";
import { taskLog } from "./task-log";

const AT = "2026-10-17T12:00:00.000Z";
const END = "2026-10-17T12:00:02.000Z";
const turn = (): ObservedTurn => ({
	at: AT,
	until: null,
	firstText: null,
	requested: "opencode-go/test",
	confirmed: "opencode-go/test",
	cwd: "/repo",
	tokens: null,
});
const cost = (amount: number) => ({
	sessionUpdate: "usage_update" as const,
	used: 80,
	size: 1000,
	cost: { amount, currency: "USD" },
});

describe("OpenCode usage observations", () => {
	it("replaces cumulative costs including decreases, ignores children, and never fabricates quota", () => {
		const state = blank("c", "opencode", null, AT);
		fold(state, cost(2), AT);
		fold(state, cost(2), AT);
		fold(state, cost(3), AT);
		fold(
			state,
			{ ...cost(99), _meta: { "opencode/child-session": { id: "child" } } },
			AT,
		);
		expect(state.usage.cost?.amount).toBe(3);
		expect(state.usage.context?.used).toBe(80);
		fold(state, cost(1), END);
		expect(state.usage.cost?.amount).toBe(1);
		expect(state.usage.limits).toEqual([]);
		fold(state, { sessionUpdate: "usage_update", used: 0, size: 1000 }, END);
		expect(state.usage.cost).toBeNull();
	});

	it("retains zero, missing cache fields, first parent text and per-turn tokens without duplicate tally", () => {
		const state = blank("c", "opencode", null, AT);
		state.usage.opencode?.turns.push(turn());
		fold(
			state,
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "child" },
				_meta: { "opencode/child-session": { id: "child" } },
			},
			AT,
		);
		fold(
			state,
			{
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "thinking" },
			},
			AT,
		);
		fold(
			state,
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "answer" },
			},
			END,
		);
		const usage = { inputTokens: 0, outputTokens: 10, totalTokens: 10 };
		tally(state, usage);
		tally(state, usage);
		finishObservation(state, END);
		expect(state.usage.opencode?.turns[0]).toMatchObject({
			firstText: END,
			until: END,
			tokens: { input: 0, output: 10, cachedRead: null, cachedWrite: null },
		});
	});

	it("drops unsupported metrics instead of manufacturing zero", () => {
		const state = blank("c", "opencode", null, AT);
		state.usage.opencode?.turns.push(turn());
		tally(state, { inputTokens: Number.NaN, outputTokens: -1, totalTokens: 0 });
		fold(state, cost(Number.POSITIVE_INFINITY));
		expect(state.usage.cost).toBeNull();
		expect(state.usage.opencode?.turns[0]?.tokens).toEqual({
			input: null,
			output: null,
			cachedRead: null,
			cachedWrite: null,
		});
	});

	it("redacts provider diagnostics and discards raw response bodies", () => {
		const update = safeOpenCodeUpdate({
			sessionUpdate: "session_info_update",
			_meta: {
				"opencode/retry": {
					attempt: 1,
					nextRetryAt: END,
					error: {
						message: "Rate limited Bearer sensitive api_key=private",
						type: "provider.rate-limit",
						status: 429,
						response: { body: "raw-secret" },
					},
				},
			},
		});
		const state = blank("c", "opencode", null, AT);
		fold(state, update, AT);
		expect(JSON.stringify(update)).not.toContain("sensitive");
		expect(JSON.stringify(update)).not.toContain("private");
		expect(JSON.stringify(update)).not.toContain("raw-secret");
		expect(state.usage.opencode?.retry?.message).toContain("Rate limited");
		expect(state.usage.opencode?.retry?.status).toBe(429);
		fold(state, {
			sessionUpdate: "session_info_update",
			_meta: { "opencode/retry": null },
		});
		expect(state.usage.opencode?.retry).toBeNull();
	});

	it("keeps old logs readable without inventing dispatch times or zero token observations", async () => {
		const fs = new FakeFs();
		const log = new ConversationLog("/old", fs, new FakeTimer());
		log.write({
			kind: "start",
			id: "old",
			agent: "opencode",
			task: null,
			createdAt: AT,
		});
		log.write({ kind: "prompt", text: "old prompt" });
		log.write({
			kind: "usage",
			usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
		});
		await log.flush();
		const read = await log.replay();
		expect(read?.state.usage.opencode?.turns).toEqual([]);
		expect(read?.state.usage.cost).toBeNull();
		expect(read?.state.messages[0]?.at).toBeNull();
	});

	it.each(["claude", "codex"])(
		"preserves %s token and process-reset accounting",
		(agent) => {
			const state = blank("c", agent, null, AT);
			tally(state, {
				inputTokens: 10,
				outputTokens: 4,
				cachedReadTokens: 3,
				cachedWriteTokens: 2,
				totalTokens: 19,
			});
			fold(state, cost(2));
			fold(state, cost(1));
			expect(state.usage.input).toBe(15);
			expect(state.usage.output).toBe(4);
			expect(state.usage.cached).toBe(3);
			expect(state.usage.cost?.amount).toBe(3);
			expect(state.usage.opencode).toBeUndefined();
		},
	);

	it("replays observations once, retaining model snapshots and missing usage in later turns", async () => {
		const fs = new FakeFs();
		const timer = new FakeTimer();
		const log = new ConversationLog("/log", fs, timer);
		log.write({
			kind: "start",
			id: "c",
			agent: "opencode",
			task: null,
			createdAt: AT,
			cwd: "/repo",
		});
		log.write({ kind: "model-request", model: "opencode-go/test" });
		log.write({ kind: "observed-turn", turn: turn() });
		log.write({ kind: "update", update: cost(3), at: AT });
		log.write({ kind: "update", update: cost(3), at: AT });
		log.write({
			kind: "usage",
			usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 },
		});
		log.write({
			kind: "usage",
			usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 },
		});
		log.write({ kind: "turn", running: false, at: END });
		log.write({
			kind: "observed-turn",
			turn: {
				...turn(),
				requested: "opencode-go/other",
				confirmed: "opencode-go/other",
				at: END,
			},
		});
		log.write({ kind: "turn", running: false, at: END });
		await log.flush();
		const first = await log.replay();
		const second = await log.replay();
		expect(first?.state.usage).toEqual(second?.state.usage);
		expect(first?.state.usage.cost?.amount).toBe(3);
		expect(
			first?.state.usage.opencode?.turns.map(
				(each) => each.tokens?.input ?? null,
			),
		).toEqual([12, null]);
		expect(first?.model).toBe("opencode-go/test");
		expect((await taskLog("/log", fs, AT, END))?.usage).toBeUndefined();
	});
});
