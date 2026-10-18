import type * as acp from "@agentclientprotocol/sdk";
import {
	appendSummary,
	compactionIn,
	fillCompaction,
	isCompaction,
	newCompaction,
	updateCompaction,
} from "./compaction";
import type {
	ConversationState,
	Field,
	Limit,
	Message,
	Part,
	Setting,
	Tool,
} from "./conversation-state";
import { metric, observeTokens, safeOpenCodeUpdate } from "./opencode-usage";
import { fill, parentOf, toolIn } from "./tool-calls";

/**
 * Folds one ACP update, sent `at`, into the messages: text runs on in the
 * message it started, and a tool call is one part that fills in as it runs.
 */
export function fold(
	state: ConversationState,
	update: acp.SessionUpdate,
	at: string | null = null,
): void {
	if (
		state.agent === "opencode" &&
		parentOf(update) !== null &&
		update.sessionUpdate !== "tool_call" &&
		update.sessionUpdate !== "tool_call_update"
	) {
		return;
	}
	const report = state.usage.opencode;
	if (report !== undefined) {
		const retry = safeOpenCodeUpdate(update)._meta?.["opencode/retry"];
		if (retry !== undefined) {
			const value = retry as {
				attempt: number | null;
				nextRetryAt: string | null;
				error: { message: string; type: string | null; status: number | null };
			} | null;
			report.retry =
				value === null
					? null
					: {
							attempt: value.attempt,
							nextRetryAt: value.nextRetryAt,
							message: value.error.message,
							type: value.error.type,
							status: value.error.status,
						};
		}
		const turn = report.turns.at(-1);
		if (
			turn !== undefined &&
			turn.until === null &&
			turn.firstText === null &&
			update.sessionUpdate === "agent_message_chunk" &&
			update.content.type === "text" &&
			update.content.text.length > 0
		) {
			turn.firstText = at;
		}
	}
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
		case "agent_thought_chunk": {
			// A subagent's words are its own, kept in the log but out of the
			// conversation's: its tool call stands for it.
			if (update.content.type !== "text" || parentOf(update) !== null) {
				return;
			}
			const turn = agentTurn(state, at);
			const last = turn.parts.at(-1);
			const type =
				update.sessionUpdate === "agent_message_chunk" ? "text" : "thought";
			const message = update.messageId ?? null;
			const { text } = update.content;
			if (last?.type === type) {
				// A new message, as Codex says each of a turn's, starts a
				// paragraph rather than running on from the last.
				const next =
					message !== null && last.message != null && last.message !== message;
				last.text += next ? `\n\n${text}` : text;
				if (message !== null) {
					last.message = message;
				}
			} else {
				turn.parts.push({
					type,
					text,
					at,
					...(message === null ? {} : { message }),
				});
			}
			return;
		}
		case "tool_call": {
			if (isCompaction(update)) {
				// Reported first as it ends, when its start was missed.
				const known = compactionIn(state, update.toolCallId);
				const part = known ?? newCompaction(update.toolCallId, at);
				if (known === null) {
					agentTurn(state, at).parts.push(part);
				}
				fillCompaction(part, update, at);
				moved(state, at);
				return;
			}
			// Already made, when asking permission for it came first.
			const made = toolIn(state, update.toolCallId);
			if (made !== null) {
				fill(made, update, at);
				return;
			}
			const tool: Tool = {
				type: "tool",
				id: update.toolCallId,
				title: update.title,
				status: "pending",
				kind: update.kind ?? null,
				command: null,
				target: null,
				output: "",
				edits: [],
				paths: [],
				parent: parentOf(update),
				at,
				until: null,
				flags: [],
				decision: null,
			};
			const place =
				tool.parent === null ? null : besideSpawn(state, tool.parent);
			if (place === null) {
				agentTurn(state, at).parts.push(tool);
			} else {
				place.parts.splice(place.at, 0, tool);
				moved(state, at);
			}
			fill(tool, update, at);
			return;
		}
		case "tool_call_update": {
			const part = toolIn(state, update.toolCallId);
			if (part !== null) {
				fill(part, update, at);
				moved(state, at);
				return;
			}
			const compaction = compactionIn(state, update.toolCallId);
			if (compaction !== null) {
				fillCompaction(compaction, update, at);
				moved(state, at);
			}
			return;
		}
		case "compaction_update": {
			// Upserted by its id: the first update fixes its place.
			const known = compactionIn(state, update.compactionId);
			const part = known ?? newCompaction(update.compactionId, at);
			if (known === null) {
				agentTurn(state, at).parts.push(part);
			}
			updateCompaction(part, update, at);
			moved(state, at);
			return;
		}
		case "compaction_summary_chunk": {
			const part = compactionIn(state, update.compactionId);
			if (part !== null) {
				appendSummary(part, update);
				moved(state, at);
			}
			return;
		}
		case "plan":
			agentTurn(state, at).plan = update.entries.map((entry) => ({
				text: entry.content,
				status: entry.status,
			}));
			return;
		case "session_info_update":
			if (update.title !== undefined) {
				state.title = update.title;
			}
			return;
		case "config_option_update":
			state.settings = settingsIn(update.configOptions);
			return;
		case "available_commands_update":
			state.commands = update.availableCommands.map((command) => ({
				name: command.name,
				description: command.description,
				hint: command.input?.hint ?? null,
			}));
			return;
		case "usage_update":
			if (state.agent === "opencode") {
				state.usage.context =
					metric(update.used) !== null && metric(update.size) !== null
						? { used: update.used, size: update.size }
						: null;
				state.usage.cost =
					update.cost != null &&
					metric(update.cost.amount) !== null &&
					update.cost.currency === "USD"
						? { ...update.cost, said: update.cost.amount }
						: null;
				if (report !== undefined) {
					report.costAt = at;
				}
				return;
			}
			// The plan's, whoever's turn it came in.
			state.usage.limits = heard(state.usage.limits, limitsIn(update, at));
			// A subagent's context is its own.
			if (parentOf(update) !== null) {
				return;
			}
			state.usage.context = { used: update.used, size: update.size };
			if (update.cost != null) {
				const { amount, currency } = update.cost;
				const before = state.usage.cost;
				const carried =
					before === null
						? 0
						: before.amount - (amount < before.said ? 0 : before.said);
				state.usage.cost = { amount: carried + amount, currency, said: amount };
			}
			return;
		case "current_mode_update":
			state.settings = state.settings.map((setting) =>
				setting.category === "mode"
					? { ...setting, current: update.currentModeId }
					: setting,
			);
			return;
		default:
			return;
	}
}

/**
 * The windows Claude's rate limit info in `update` tells of: every one in
 * `unifiedWindows` when it sends them, else the one it names. Its
 * `utilization` runs from 0 to 1, and `resetsAt` is in seconds.
 */
export function limitsIn(update: acp.UsageUpdate, at: string | null): Limit[] {
	const info = update._meta?.["_claude/rateLimit"] as
		| {
				rateLimitType?: unknown;
				utilization?: unknown;
				resetsAt?: unknown;
				unifiedWindows?: Record<
					string,
					{ utilization?: unknown; resetsAt?: unknown } | undefined
				>;
		  }
		| undefined;
	if (info == null) {
		return [];
	}
	const windows: [string, { utilization?: unknown; resetsAt?: unknown }][] =
		info.unifiedWindows != null
			? Object.entries(info.unifiedWindows).flatMap(([window, each]) =>
					each == null ? [] : [[window, each]],
				)
			: typeof info.rateLimitType === "string"
				? [[info.rateLimitType, info]]
				: [];
	return windows.flatMap(([window, { utilization, resetsAt }]) =>
		typeof utilization === "number" && typeof resetsAt === "number"
			? [
					{
						window,
						used: utilization,
						resets: new Date(resetsAt * 1000).toISOString(),
						at,
					},
				]
			: [],
	);
}

/** `limits`, each window in `news` replaced by what it says now. */
export function heard(limits: Limit[], news: Limit[]): Limit[] {
	if (news.length === 0) {
		return limits;
	}
	const said = new Set(news.map((each) => each.window));
	return [...limits.filter((each) => !said.has(each.window)), ...news];
}

/** Adds the tokens a turn used to those of the turns before it. */
export function tally(state: ConversationState, usage: acp.Usage): void {
	if (state.agent === "opencode") {
		observeTokens(state, usage);
		return;
	}
	const cached = usage.cachedReadTokens ?? 0;
	state.usage.input +=
		usage.inputTokens + cached + (usage.cachedWriteTokens ?? 0);
	state.usage.cached += cached;
	state.usage.output += usage.outputTokens;
}

/**
 * The agent's message at the end, started if the person spoke last, marked
 * as having moved `at`. Queued messages stay below it: the agent has yet to
 * hear them, so nothing it says meanwhile answers them.
 */
export function agentTurn(
	state: ConversationState,
	at: string | null,
): Message {
	const { messages } = state;
	let end = messages.length;
	while (messages[end - 1]?.queued) {
		end--;
	}
	const last = messages[end - 1];
	if (last?.role === "agent") {
		last.until = at ?? last.until;
		return last;
	}
	const turn: Message = {
		role: "agent",
		parts: [],
		plan: null,
		at,
		until: at,
	};
	messages.splice(end, 0, turn);
	return turn;
}

/**
 * Where a call made by the subagent tool call `parent` goes: after that call
 * and the subagent's calls before it, in the turn it was made in, so a
 * subagent still at work once the agent has replied, or in a later turn,
 * keeps every call under it. Null when no such call was made.
 */
function besideSpawn(
	state: ConversationState,
	parent: string,
): { parts: Part[]; at: number } | null {
	for (const { parts } of state.messages) {
		const last = parts.findLastIndex(
			(part) =>
				part.type === "tool" && (part.id === parent || part.parent === parent),
		);
		if (last !== -1) {
			return { parts, at: last + 1 };
		}
	}
	return null;
}

/** Marks the agent's message at the end, if it is the last, as having moved `at`. */
export function moved(state: ConversationState, at: string | null): void {
	const last = state.messages.at(-1);
	if (last?.role === "agent" && at !== null) {
		last.until = at;
	}
}

/** Whether `update` is the agent at work, as it is only in a turn. */
export function starts(update: acp.SessionUpdate): boolean {
	return (
		(update.sessionUpdate === "agent_message_chunk" ||
			update.sessionUpdate === "agent_thought_chunk" ||
			update.sessionUpdate === "tool_call") &&
		parentOf(update) === null
	);
}

/**
 * Whether `update` ends a turn: Claude says where each turn came from in the
 * usage it sends at the turn's end, and only then.
 */
export function result(update: acp.SessionUpdate): boolean {
	return (
		update.sessionUpdate === "usage_update" &&
		update._meta?.["_claude/origin"] != null
	);
}

/** The session's settings the agent lets the person pick from, in its order. */
export function settingsIn(
	options: acp.SessionConfigOption[] | null | undefined,
): Setting[] {
	return (options ?? []).flatMap((option): Setting[] => {
		if (option.type === "boolean") {
			return [
				{
					id: option.id,
					name: option.name,
					type: "boolean",
					category: option.category ?? null,
					current: option.currentValue ? "on" : "off",
					options: [
						{ value: "on", name: "On", description: null },
						{ value: "off", name: "Off", description: null },
					],
				},
			];
		}
		if (option.type !== "select") {
			return [];
		}
		const flat = option.options.flatMap((each) =>
			"group" in each ? each.options : [each],
		);
		return [
			{
				id: option.id,
				name: option.name,
				type: "select",
				category: option.category ?? null,
				current: option.currentValue,
				options: flat.map((each) => ({
					value: each.value,
					name: each.name,
					description: each.description ?? null,
				})),
			},
		];
	});
}

/** `value` for `setting` as ACP sets it: a toggle's as a boolean. */
export function configValue(
	setting: Setting,
	value: string,
): { type: "boolean"; value: boolean } | { value: string } {
	return setting.type === "boolean"
		? { type: "boolean", value: value === "on" }
		: { value };
}

/** A form an agent asks with, as the fields the page shows. */
export function fieldsIn(schema: unknown): Field[] {
	const properties =
		typeof schema === "object" && schema !== null && "properties" in schema
			? (schema.properties as Record<string, Record<string, unknown>>)
			: {};
	return Object.entries(properties).map(([key, property]) => {
		const oneOf = property.oneOf as
			| { const: string; title?: string; description?: string }[]
			| undefined;
		const enums = property.enum as string[] | undefined;
		const choices =
			oneOf?.map((choice) => ({
				value: String(choice.const),
				title: choice.title ?? String(choice.const),
				description: choice.description ?? null,
			})) ??
			enums?.map((value) => ({ value, title: value, description: null })) ??
			null;
		return {
			key,
			title: String(property.title ?? key),
			description:
				typeof property.description === "string" ? property.description : null,
			choices,
		};
	});
}
