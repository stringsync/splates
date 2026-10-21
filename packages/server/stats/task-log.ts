import type * as acp from "@agentclientprotocol/sdk";
import { agentTurn, fold, tally } from "../agents";
import { LEGACY_PLAN_FILE } from "../config";
import type { Entry } from "../conversations";
import {
	blank,
	type ConversationState,
	type Message,
	runOn,
	type Usage,
} from "../conversations";
import { modelValue } from "../models";
import { PLAN_FILE, stretches } from "../plans";
import { type Catalog, catalogKey, priced, type TurnTokens } from "../prices";
import type { Log } from "../storage";

/** What a task's turns used, apart from the rest of its conversation's. */
export interface TaskUsage {
	/** Tokens read, those from cache among them. */
	input: number;
	cached: number;
	output: number;
	/**
	 * What it cost at the API's list price: as Claude says, or for Codex and
	 * OpenCode, which say none or their plan's, its tokens at the model's
	 * public price. Null when neither is known.
	 */
	cost: {
		amount: number;
		currency: string;
		/** True when splates priced its tokens, rather than the agent saying. */
		listPrice?: boolean;
	} | null;
}

/** What a task's stretch of its conversation shows of how the work went. */
export interface TaskLog {
	/** What the task's turns used, when its agent reported any. */
	usage: TaskUsage | undefined;
	/** Each agent turn's span, start to last move, summed. */
	workedMs: number;
	/** The agent turns that ran in it, the one it ended in among them. */
	turns: number;
	/** When the person stopped the agent's turn, each time. */
	stopped: string[];
	/** When a lost connection cut the agent's turn short, each time. */
	interrupted: string[];
	/** How many times each command failed. */
	failedCommands: Record<string, number>;
	/** Lines the agent's edits took out and put in, its plan's aside. */
	editedLines: number;
	/** Turns that ended asking the person questions. */
	questionRounds: number;
	/** Turns that ended asking the person to review the work. */
	reviewRounds: number;
	/**
	 * How long those turns waited on the person, each until the next thing
	 * they said, or the task's end.
	 */
	waitedMs: number;
	/** What the person set the model or effort to after Auto pick, in order. */
	overrides: { aspect: "model" | "effort"; value: string; at: string }[];
}

/**
 * Reads the conversation logged in `log` from `since` to `until`: a
 * conversation can outlive the task, or come to it already under way. Null
 * when there is no such log. Read raw rather than replayed, since the agent
 * merging is still writing it. An agent that says no API cost of its own has
 * its turns priced from `opts.catalog`.
 */
export async function taskLog(
	log: Log<Entry>,
	since: string,
	until: string,
	opts: TaskLogOptions = {},
): Promise<TaskLog | null> {
	const entries = await log.replay();
	const start = entries[0];
	if (start?.kind !== "start") {
		return null;
	}
	const state = blank(start.id, start.agent, start.task, start.createdAt);
	// The usage the conversation had run up as the task began. Usage lines
	// say no time, so each falls on the last time a line said.
	let before: Usage | null = null;
	// The task's turns, each with the model it ran on, for pricing.
	const turns: { model: string | null; tokens: TurnTokens }[] = [];
	let requested: string | null = null;
	const overrides: TaskLog["overrides"] = [];
	for (const entry of entries) {
		const at = "at" in entry && typeof entry.at === "string" ? entry.at : null;
		if (at !== null && at > until) {
			break;
		}
		if (before === null && at !== null && at >= since) {
			before = structuredClone(state.usage);
		}
		if (entry.kind === "update") {
			fold(state, entry.update, at);
		} else if (entry.kind === "usage") {
			tally(state, entry.usage);
			// OpenCode's turns are priced as observed, each once, below.
			if (before !== null && state.agent !== "opencode") {
				turns.push({
					model: turnModel(state, requested),
					tokens: turnTokens(entry.usage, state),
				});
			}
		} else if (entry.kind === "settings") {
			state.settings = entry.settings;
		} else if (entry.kind === "override") {
			if (entry.at >= since) {
				overrides.push({
					aspect: entry.aspect,
					value: entry.value,
					at: entry.at,
				});
			}
		} else if (entry.kind === "model-request") {
			requested = entry.model;
		} else if (entry.kind === "observed-turn") {
			state.usage.opencode?.turns.push(entry.turn);
		} else if (entry.kind === "agent") {
			// Auto's pick moves a conversation off the agent it started on.
			runOn(state, entry.agent);
		} else if (entry.kind === "stopped") {
			agentTurn(state, entry.at).stopped = entry.at;
		} else if (entry.kind === "interrupted") {
			agentTurn(state, entry.at).interrupted = entry.at;
		} else if (entry.kind === "prompt" && !entry.queued) {
			// Its words stand for nothing here, but the next turn starts after them.
			state.messages.push({
				role: "user",
				parts: [],
				plan: null,
				at,
				until: at,
			});
		}
	}
	turns.push(...observedTurns(state, since, until));
	const result = summed(state, before ?? state.usage, since, until, {
		turns,
		catalog:
			LISTED.includes(state.agent) && opts.catalog !== undefined
				? await opts.catalog()
				: null,
	});
	result.overrides = overrides;
	return result;
}

export interface TaskLogOptions {
	/**
	 * The API list prices to price an agent's turns at when it says no cost
	 * of its own, asked for only then; none prices nothing.
	 */
	catalog?: () => Promise<Catalog | null>;
}

/** Agents that say no API cost of their own, so splates prices their tokens. */
const LISTED = ["codex", "opencode"];

/**
 * OpenCode's turns from `since` to `until` that said their tokens, as it
 * observed them: once each, however many times its usage was logged, and
 * its parent session's alone.
 */
function observedTurns(
	state: ConversationState,
	since: string,
	until: string,
): Pricing["turns"] {
	return (state.usage.opencode?.turns ?? []).flatMap((turn) =>
		turn.tokens === null || turn.at < since || turn.at > until
			? []
			: [
					{
						model: turn.confirmed ?? turn.requested,
						tokens: {
							input: turn.tokens.input ?? 0,
							cachedRead: turn.tokens.cachedRead ?? 0,
							cachedWrite: turn.tokens.cachedWrite ?? 0,
							output: turn.tokens.output ?? 0,
							context: null,
						},
					},
				],
	);
}

/** The model Codex's turn ran on: the one its settings show, else the one asked for. */
function turnModel(
	state: ConversationState,
	requested: string | null,
): string | null {
	return modelValue(state.settings) ?? requested;
}

function turnTokens(usage: acp.Usage, state: ConversationState): TurnTokens {
	return {
		input: usage.inputTokens,
		cachedRead: usage.cachedReadTokens ?? 0,
		cachedWrite: usage.cachedWriteTokens ?? 0,
		output: usage.outputTokens,
		context: state.usage.context?.used ?? null,
	};
}

/**
 * What the task's turns used: as the agent tallied them, or for one that
 * says no API cost, as its turns priced at `catalog` add up to, null when a
 * turn's model has no price there.
 */
function used(
	state: ConversationState,
	before: Usage,
	{ turns, catalog }: Pricing,
): TaskUsage | undefined {
	const after = state.usage;
	const keys = turns.map((turn) => catalogKey(state.agent, turn.model));
	const listed = LISTED.includes(state.agent)
		? keys.map((key) => (key === null ? undefined : catalog?.[key]))
		: null;
	if (listed === null) {
		return {
			input: after.input - before.input,
			cached: after.cached - before.cached,
			output: after.output - before.output,
			cost:
				after.cost === null
					? null
					: {
							amount: after.cost.amount - (before.cost?.amount ?? 0),
							currency: after.cost.currency,
						},
		};
	}
	let amount = 0;
	for (const [at, turn] of turns.entries()) {
		const price = listed[at];
		amount =
			price === undefined ? Number.NaN : amount + priced(price, turn.tokens);
	}
	const sum = (pick: (tokens: TurnTokens) => number) =>
		turns.reduce((total, turn) => total + pick(turn.tokens), 0);
	return {
		input: sum((each) => each.input + each.cachedRead + each.cachedWrite),
		cached: sum((each) => each.cachedRead),
		output: sum((each) => each.output),
		cost: Number.isNaN(amount)
			? null
			: { amount, currency: "USD", listPrice: true },
	};
}

interface Pricing {
	turns: { model: string | null; tokens: TurnTokens }[];
	catalog: Catalog | null;
}

function summed(
	state: ConversationState,
	before: Usage,
	since: string,
	until: string,
	pricing: Pricing,
): TaskLog {
	const result: TaskLog = {
		usage: used(state, before, pricing),
		workedMs: 0,
		turns: 0,
		stopped: [],
		interrupted: [],
		failedCommands: {},
		editedLines: 0,
		questionRounds: 0,
		reviewRounds: 0,
		waitedMs: 0,
		overrides: [],
	};
	for (const [at, message] of state.messages.entries()) {
		if (message.stopped !== undefined && message.stopped >= since) {
			result.stopped.push(message.stopped);
		}
		if (message.interrupted !== undefined && message.interrupted >= since) {
			result.interrupted.push(message.interrupted);
		}
		if (message.role !== "agent" || message.at === null) {
			continue;
		}
		if (message.until !== null && message.until > since) {
			result.turns += 1;
			result.workedMs += Math.max(
				0,
				Date.parse(message.until) -
					Date.parse(message.at < since ? since : message.at),
			);
			asked(result, message, state.messages.slice(at + 1), until);
		}
		for (const part of message.parts) {
			if (part.type !== "tool" || part.at === null || part.at < since) {
				continue;
			}
			if (part.status === "failed" && part.command !== null) {
				result.failedCommands[part.command] =
					(result.failedCommands[part.command] ?? 0) + 1;
			}
			for (const edit of part.edits) {
				if (
					![PLAN_FILE, LEGACY_PLAN_FILE].some((name) =>
						edit.path.endsWith(`/${name}`),
					)
				) {
					result.editedLines += lines(edit.old) + lines(edit.new);
				}
			}
		}
	}
	return result;
}

/**
 * Counts `turn` into `result`'s rounds when it ended asking the person
 * something, with how long it waited on them: until the first of `after`
 * they said, or `until`.
 */
function asked(
	result: TaskLog,
	turn: Message,
	after: Message[],
	until: string,
): void {
	const text = turn.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n\n");
	const found = stretches(text).map((stretch) => stretch.type);
	const questions = found.includes("questions");
	const review = found.includes("review");
	if (!questions && !review) {
		return;
	}
	if (questions) {
		result.questionRounds += 1;
	} else {
		result.reviewRounds += 1;
	}
	const answered =
		after.find((each) => each.role === "user" && each.at !== null)?.at ?? until;
	result.waitedMs += Math.max(
		0,
		Date.parse(answered) - Date.parse(turn.until ?? until),
	);
}

function lines(text: string | null): number {
	return text === null || text === "" ? 0 : text.split("\n").length;
}
