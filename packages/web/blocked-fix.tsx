import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import { blockerLabel } from "@stringsync/splates-server/board/browser";
import {
	blockage,
	isBlocked,
	queueOrder,
	waitedOn,
} from "@stringsync/splates-server/queue/browser";
import { ListPlusIcon, Unlink2Icon } from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { linkTodo, queueTodo } from "./api";
import { Board, still, touchArea } from "./board";
import { linked, queued } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";

/**
 * What clears a blocked task, as its card offers: queue the tasks it waits
 * on that nothing will start, blockers first; drop its links to blockers
 * removed without merging; or nothing of its own, since blocked task `id`
 * holds the same fix, a task it waits on or one above it in its lane.
 */
export type BlockedFix =
	| { kind: "queue"; chain: TaskRecord[] }
	| { kind: "drop"; lost: number[] }
	| { kind: "with"; id: number };

/** What clears `todo`, among `todos`; null for one not blocked. */
export function blockedFix(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
): BlockedFix | null {
	return fixOf(todo, todos, new Set());
}

function fixOf(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
	seen: Set<number>,
): BlockedFix | null {
	if (!isBlocked(todo, todos)) {
		return null;
	}
	const own = blockage(todo, todos);
	const fallback: BlockedFix | null =
		own.chain.length > 0
			? { kind: "queue", chain: own.chain }
			: own.lost.length > 0
				? { kind: "drop", lost: own.lost }
				: null;
	if (own.lost.length > 0 || seen.has(todo.id)) {
		return fallback;
	}
	seen.add(todo.id);
	const mine = new Set(own.chain.map((task) => task.id));
	const covers = (other: TaskRecord) => {
		if (other.id === todo.id || !isBlocked(other, todos)) {
			return false;
		}
		const theirs = new Set(blockage(other, todos).chain.map((task) => task.id));
		return [...mine].every((id) => theirs.has(id));
	};
	const below = waitedOn(todo, todos).filter(
		(other) => other.stage === "queued",
	);
	// Above it in its lane, never one waiting on it, so no two point at each other.
	const above =
		todo.lane === null
			? []
			: todos
					.filter(
						(other) =>
							other.lane === todo.lane &&
							other.position < todo.position &&
							!waitedOn(other, todos).some((each) => each.id === todo.id),
					)
					.sort((left, right) => left.position - right.position);
	const holder = [...below, ...above].find(covers);
	if (holder === undefined) {
		return fallback;
	}
	const theirs = fixOf(holder, todos, seen);
	return theirs?.kind === "with" ? theirs : { kind: "with", id: holder.id };
}

/** The queued tasks of `todos` that start without the person: the queue's order, less the blocked. */
export function upNext(todos: readonly TaskRecord[]): TaskRecord[] {
	return queueOrder(todos).filter((todo) => !isBlocked(todo, todos));
}

/** The queued tasks of `todos` that are blocked, in the queue's order. */
export function blockedQueue(todos: readonly TaskRecord[]): TaskRecord[] {
	return queueOrder(todos).filter((todo) => isBlocked(todo, todos));
}

/** Each of `chain` on a line of its own, `#2 in Licensing Check licenses`. */
export function chainLines(
	chain: readonly TaskRecord[],
	lanes: LaneRecord[],
): string {
	return chain
		.map((task) => `${blockerLabel(task, lanes)} ${task.subject}`)
		.join("\n");
}

/** What a fix's button says. */
export function fixLabel(fix: BlockedFix): string {
	switch (fix.kind) {
		case "queue":
			return `Queue ${fix.chain.length === 1 ? "1 blocker" : `${fix.chain.length} blockers`}`;
		case "drop":
			return `Drop link${fix.lost.length === 1 ? "" : "s"} to ${fix.lost.map((id) => `#${id}`).join(", ")}`;
		case "with":
			return `Blocked with #${fix.id}`;
	}
}

/**
 * Applies `todo`'s fix: queues its chain, blockers first, or drops its
 * links to removed blockers, each pending until the server shows it; gives
 * back the tasks it queued, for Undo.
 */
export function useApplyFix(): (
	todo: TaskRecord,
	fix: BlockedFix,
) => Promise<number[]> {
	const expect = useExpectSnapshot();
	return async (todo, fix) => {
		if (fix.kind === "queue") {
			const ids = fix.chain.map((task) => task.id);
			for (const id of ids) {
				await expect(queued(id, true), queueTodo(id, true));
			}
			return ids;
		}
		if (fix.kind === "drop") {
			await expect(
				linked(todo.id, todo.blockedBy),
				linkTodo(todo.id, todo.blockedBy),
			);
		}
		return [];
	};
}

/** Takes tasks `ids`, queued by a fix, back out of the queue: its Undo. */
export function useUndoQueued(): (ids: readonly number[]) => Promise<void> {
	const expect = useExpectSnapshot();
	return async (ids) => {
		for (const id of [...ids].reverse()) {
			await expect(queued(id, false), queueTodo(id, false));
		}
	};
}

/**
 * A blocked card's fix on its line: its button, the chain it queues on
 * hover, or "Blocked with #3", which opens that card; once its blockers
 * are queued, which ones, with Undo, for a while. A refusal is said on the
 * card. Nothing for a card not blocked and nothing just queued.
 */
export function BlockedFixButton({
	todo,
}: {
	todo: TaskRecord;
}): JSX.Element | null {
	const { todos, lanes, open, refuseTodo } = useContext(Board);
	const apply = useApplyFix();
	const undo = useUndoQueued();
	const [done, setDone] = useState<number[] | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (done === null) {
			return;
		}
		const timer = setTimeout(() => setDone(null), 15_000);
		return () => clearTimeout(timer);
	}, [done]);
	if (done !== null) {
		return (
			<span className="relative inline-flex items-center gap-1.5 text-foreground">
				Queued {done.map((id) => `#${id}`).join(", ")}
				<button
					type="button"
					{...still}
					disabled={busy}
					onClick={() => {
						setBusy(true);
						void undo(done)
							.catch((error: unknown) =>
								refuseTodo(todo.id, "Not undone", error),
							)
							.finally(() => {
								setBusy(false);
								setDone(null);
							});
					}}
					className={cn(
						"cursor-pointer rounded font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
						touchArea,
					)}
				>
					Undo
				</button>
			</span>
		);
	}
	const fix = blockedFix(todo, todos);
	if (fix === null) {
		return null;
	}
	if (fix.kind === "with") {
		return (
			<button
				type="button"
				{...still}
				onClick={() => open(fix.id)}
				title={`#${fix.id}'s fix clears this one too`}
				className={cn(
					"relative cursor-pointer rounded text-warning outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
					touchArea,
				)}
			>
				{fixLabel(fix)}
			</button>
		);
	}
	const Icon = fix.kind === "queue" ? ListPlusIcon : Unlink2Icon;
	const button = (
		<button
			type="button"
			{...still}
			disabled={busy}
			onClick={() => {
				setBusy(true);
				void apply(todo, fix)
					.then((ids) => {
						if (ids.length > 0) {
							setDone(ids);
						}
					})
					.catch((error: unknown) =>
						refuseTodo(
							todo.id,
							fix.kind === "queue" ? "Blockers not queued" : "Not unlinked",
							error,
						),
					)
					.finally(() => setBusy(false));
			}}
			className={cn(
				"relative inline-flex cursor-pointer items-center gap-1 rounded-md border border-warning/40 bg-card px-1.5 py-px font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
				touchArea,
			)}
		>
			<Icon aria-hidden className="size-3" />
			{fixLabel(fix)}
		</button>
	);
	if (fix.kind === "drop") {
		return button;
	}
	return (
		<Tooltip>
			<TooltipTrigger render={button} />
			<TooltipContent className="whitespace-pre-line">
				{chainLines(fix.chain, lanes)}
			</TooltipContent>
		</Tooltip>
	);
}
