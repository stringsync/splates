import type { TaskRecord } from "@splates/server/board";
import type { ChainBudgetReading } from "@splates/server/queue/browser";
import { BotIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { readChainSpends } from "./api";

/** How often the page asks again what each agent-queued chain has spent. */
const REFRESH_MS = 30_000;

/** Tokens as "1.8M", or "820k" under a million. */
export function tokens(count: number): string {
	return count >= 1_000_000
		? `${Number((count / 1_000_000).toFixed(1))}M`
		: `${Math.round(count / 1000)}k`;
}

/** What each agent-queued chain has spent, by root conversation, kept fresh. */
export function useChainSpends(): Record<string, ChainBudgetReading> {
	const [spends, setSpends] = useState<Record<string, ChainBudgetReading>>({});
	useEffect(() => {
		let cancelled = false;
		const load = () =>
			void readChainSpends().then(
				(next) => {
					if (!cancelled) {
						setSpends(next);
					}
				},
				() => {},
			);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);
	return spends;
}

/** The task's `agent-queued` provenance, or null when a person or lane queued it. */
export function agentQueuedBy(
	todo: TaskRecord,
): Extract<NonNullable<TaskRecord["queuedBy"]>, { by: "agent" }> | null {
	return todo.queuedBy?.by === "agent" ? todo.queuedBy : null;
}

/** The "chain 1.8M of 5M" words, or "chain" while its spend is unread. */
export function chainWords(spend: ChainBudgetReading | undefined): string {
	return spend === undefined
		? "chain"
		: `chain ${tokens(spend.spent)} of ${tokens(spend.budget)}`;
}

/** The chip and the "by #N · chain X of Y" line a board card shows for an agent-queued task. */
export function AgentQueuedMark({
	todo,
}: {
	todo: TaskRecord;
}): JSX.Element | null {
	const spends = useChainSpends();
	const by = agentQueuedBy(todo);
	if (by === null) {
		return null;
	}
	return (
		<span className="flex flex-col gap-0.5">
			<span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
				<BotIcon aria-hidden className="size-3" />
				agent-queued
			</span>
			<span className="text-muted-foreground text-xs">
				{by.fromTask === undefined ? "" : `by #${by.fromTask} · `}
				{chainWords(spends[by.root.conversation])}
			</span>
		</span>
	);
}
