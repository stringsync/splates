import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import { blockerLabel } from "@stringsync/splates-server/board/browser";
import { unqueuedBlockers } from "@stringsync/splates-server/queue/browser";
import { type JSX, type SyntheticEvent, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { queueTodo } from "./api";
import { queued } from "./board-expectations";
import type { useExpectSnapshot } from "./expecting";

/** What one asking to queue holds: the tasks asked for and what blocks them unqueued. */
interface Asking {
	ids: readonly number[];
	chain: TaskRecord[];
	/** Whether queueing only `ids` is offered, as when they are not queued yet. */
	alone: boolean;
	go: (blockers: number[]) => void;
}

/**
 * Queueing that shows first what would leave it blocked: `ask` finds the
 * tasks `ids` wait on that are not queued, however far down, and with none
 * calls `go` at once; otherwise `confirm` lists that chain and offers to
 * queue it all, `go` getting its ids blockers first, or `ids` alone, `go`
 * getting none. Render `confirm` beside whatever calls `ask`.
 */
export function useQueueChain(
	todos: readonly TaskRecord[],
	lanes: LaneRecord[],
): {
	ask: (
		ids: readonly number[],
		go: (blockers: number[]) => void,
		opts?: { alone?: boolean },
	) => void;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState<Asking | null>(null);
	const ask = (
		ids: readonly number[],
		go: (blockers: number[]) => void,
		{ alone = true }: { alone?: boolean } = {},
	) => {
		const chain = unqueuedBlockers(ids, todos);
		if (chain.length === 0) {
			go([]);
		} else {
			setAsking({ ids, chain, alone, go });
		}
	};
	const answer = (blockers: number[]) => {
		asking?.go(blockers);
		setAsking(null);
	};
	const named =
		asking === null
			? ""
			: asking.ids.length === 1
				? `#${asking.ids[0]}`
				: `${asking.ids.length} tasks`;
	const confirm = (
		// The dialog's events bubble through React to whatever renders it, a
		// card a tap opens or drags among them; they stop here.
		// biome-ignore lint/a11y/noStaticElementInteractions: it only keeps events in
		<span
			className="contents"
			onClick={stop}
			onKeyDown={stop}
			onPointerDown={stop}
			onMouseDown={stop}
			onTouchStart={stop}
		>
			<Dialog
				open={asking !== null}
				onOpenChange={(open) => {
					if (!open) {
						setAsking(null);
					}
				}}
			>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Queue what it waits on too?</DialogTitle>
						<DialogDescription>
							{named} {asking?.ids.length === 1 ? "waits" : "wait"} on{" "}
							{asking?.chain.length === 1 ? "a task" : "tasks"} not in the
							queue, and stays blocked until{" "}
							{asking?.chain.length === 1 ? "it is" : "they are"} queued too:
						</DialogDescription>
					</DialogHeader>
					<ul aria-label="blockers not queued" className="flex flex-col gap-1">
						{asking?.chain.map((task) => (
							<li key={task.id} className="flex gap-2 text-sm">
								<span className="shrink-0 text-muted-foreground tabular-nums">
									{blockerLabel(task, lanes)}
								</span>
								<span className="min-w-0 flex-1 truncate">{task.subject}</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									{task.stage}
								</span>
							</li>
						))}
					</ul>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						{asking?.alone && (
							<Button variant="outline" onClick={() => answer([])}>
								Queue only {named}
							</Button>
						)}
						<Button
							onClick={() => answer(asking?.chain.map((task) => task.id) ?? [])}
						>
							{asking?.alone
								? `Queue all ${(asking?.chain.length ?? 0) + asking.ids.length}`
								: `Queue ${asking?.chain.length === 1 ? "it" : `all ${asking?.chain.length}`}`}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</span>
	);
	return { ask, confirm };
}

/** Queues each of `ids` in turn, blockers first as `useQueueChain` gives them, each pending until the server shows it. */
export async function queueEach(
	expect: ReturnType<typeof useExpectSnapshot>,
	ids: readonly number[],
): Promise<void> {
	for (const id of ids) {
		await expect(queued(id, true), queueTodo(id, true));
	}
}

function stop(event: SyntheticEvent): void {
	event.stopPropagation();
}
