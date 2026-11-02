import type { TaskRecord } from "@splates/server/board";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { chainLines, useApplyFix } from "./blocked-fix";
import { Board } from "./board";

/**
 * Queues `chain`, the blockers of `todo` nothing will start, blockers
 * first. A refusal is said on `todo`'s card; `busy` holds while the write
 * is on its way.
 */
export function useQueueBlockers(
	todo: TaskRecord,
	chain: TaskRecord[],
): { busy: boolean; run: () => void } {
	const { refuseTodo } = useContext(Board);
	const apply = useApplyFix();
	const [busy, setBusy] = useState(false);
	const run = () => {
		if (chain.length === 0 || busy) {
			return;
		}
		setBusy(true);
		void apply(todo, { kind: "queue", chain })
			.catch((error: unknown) =>
				refuseTodo(todo.id, "Blockers not queued", error),
			)
			.finally(() => setBusy(false));
	};
	return { busy, run };
}

/** `Queue 2 blockers`, or `Queue 1 blocker`. */
function label(count: number): string {
	return `Queue ${count === 1 ? "1 blocker" : `${count} blockers`}`;
}

/**
 * The centered call to action of a queued task held back by blockers nobody
 * will start: a warning triangle and the button that queues them. Nothing
 * once the whole chain is queued.
 */
export function QueueBlockersCta({
	todo,
	chain,
}: {
	todo: TaskRecord;
	chain: TaskRecord[];
}): JSX.Element | null {
	const { lanes } = useContext(Board);
	const { busy, run } = useQueueBlockers(todo, chain);
	if (chain.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col items-center gap-2 py-4 text-center">
			<TriangleAlertIcon aria-hidden className="size-6 text-warning" />
			<p className="text-sm">
				This will not start:{" "}
				{chain.length === 1 ? "a blocker is" : "blockers are"} not queued.
			</p>
			<p className="whitespace-pre-line text-muted-foreground text-xs">
				{chainLines(chain, lanes)}
			</p>
			<button
				type="button"
				disabled={busy}
				onClick={run}
				className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
			>
				{busy && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
				{label(chain.length)}
			</button>
		</div>
	);
}

/**
 * A row's quick action: a warning triangle that queues the task's blockers.
 * Nothing when the chain is queued already.
 */
export function QueueBlockersIcon({
	todo,
	chain,
	phone = false,
}: {
	todo: TaskRecord;
	chain: TaskRecord[];
	phone?: boolean;
}): JSX.Element | null {
	const { busy, run } = useQueueBlockers(todo, chain);
	if (chain.length === 0) {
		return null;
	}
	return (
		<button
			type="button"
			disabled={busy}
			aria-label={`${label(chain.length)} of ${todo.subject}`}
			title={label(chain.length)}
			onClick={run}
			className={cn(
				"flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-warning outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
				phone && "mr-3 size-9",
			)}
		>
			{busy ? (
				<Loader2Icon aria-hidden className="size-4 animate-spin" />
			) : (
				<TriangleAlertIcon aria-hidden className="size-4" />
			)}
		</button>
	);
}
