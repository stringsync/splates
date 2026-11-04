import type { ConversationState } from "@splates/server/conversations";
import type { EvalBudget } from "@splates/server/evals/browser";
import { useEffect, useState } from "react";
import { evalRun } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { reportedAs } from "./conversation-names";

/** The opening directive only: later messages can discuss unrelated loops. */
export function loopTarget(
	conversation: ConversationState,
): { scenario: string } | { run: string } | null {
	if (
		conversation.archived ||
		["merged", "removed", "deferred", "done"].includes(
			reportedAs(conversation) ?? "",
		)
	) {
		return null;
	}
	const first = conversation.messages.find(
		(message) => message.role === "user",
	);
	const text =
		first?.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n") ?? "";
	const match = text.match(/\[SPLATES EVAL LOOP (scenario )?([^\]\s]+)\]/);
	return match?.[2] === undefined
		? null
		: match[1]
			? { scenario: match[2] }
			: { run: match[2] };
}

/**
 * The dollars and rounds the person chose for a loop, read from the directive
 * that opened its conversation; null when the text is no loop directive or
 * names no limits. Choosing them is the standing permission to run its cards.
 */
export function loopLimits(text: string): EvalBudget | null {
	if (!/\[SPLATES EVAL LOOP /.test(text)) {
		return null;
	}
	const usd = Number(text.match(/^Budget: \$(\S+)/m)?.[1]);
	const rounds = Number(text.match(/^Rounds: (\d+)/m)?.[1]);
	return Number.isFinite(usd) &&
		usd > 0 &&
		Number.isInteger(rounds) &&
		rounds > 0
		? { usd, rounds }
		: null;
}

/** Open eval loops by scenario, with their current conversation status. */
export function useEvalLoops(
	feed: ConversationFeed | null,
): Map<string, ConversationState> {
	const [conversations, setConversations] = useState<ConversationState[]>(
		feed?.conversations ?? [],
	);
	const [runs, setRuns] = useState<Record<string, string>>({});
	useEffect(() => {
		setConversations(feed?.conversations ?? []);
		return feed?.events.on("changed", () =>
			setConversations(feed.conversations),
		);
	}, [feed]);
	const runIds = JSON.stringify([
		...new Set(
			conversations.flatMap((each) => {
				const target = loopTarget(each);
				return target !== null && "run" in target ? [target.run] : [];
			}),
		),
	]);
	useEffect(() => {
		let current = true;
		const ids: string[] = JSON.parse(runIds);
		for (const id of ids) {
			if (runs[id] !== undefined) {
				continue;
			}
			void evalRun(id).then(
				(detail) => {
					if (current) {
						setRuns((before) => ({ ...before, [id]: detail.scenario }));
					}
				},
				() => {},
			);
		}
		return () => {
			current = false;
		};
	}, [runIds, runs]);
	const loops = new Map<string, ConversationState>();
	for (const conversation of conversations) {
		const target = loopTarget(conversation);
		const scenario =
			target === null
				? undefined
				: "scenario" in target
					? target.scenario
					: runs[target.run];
		if (scenario !== undefined && !loops.has(scenario)) {
			loops.set(scenario, conversation);
		}
	}
	return loops;
}

/** The status label to show on a scenario’s conversation button. */
export function loopLabel(conversation: ConversationState | undefined): string {
	if (conversation === undefined) {
		return "Run";
	}
	if (conversation.ask !== null || conversation.status === "idle") {
		return "Waiting on you";
	}
	if (conversation.status === "running" || conversation.status === "starting") {
		return "Loop running";
	}
	return conversation.status === "failed" ? "Loop failed" : "Loop stopped";
}
