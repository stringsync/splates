import type { Holdup } from "@stringsync/splates-server/board";
import { TriangleAlertIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { queueTodo } from "./api";
import { Board, still } from "./board";
import { queued } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";

/**
 * A queued lane none of whose tasks will be queued until the person acts:
 * each task holding it up, why, and a button to queue it where queueing
 * it is what lets the lane go on.
 */
export function LaneStalled({
	name,
	holdups,
}: {
	/** The lane's name, labelling what holds it up. */
	name: string;
	holdups: Holdup[];
}): JSX.Element {
	const { refuseTodo } = useContext(Board);
	const expect = useExpectSnapshot();
	return (
		<section
			aria-label={`${name} stalled`}
			className="flex flex-col gap-1.5 rounded-lg border border-amber-500 bg-amber-50 px-2.5 py-2 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-100"
			title="Queued whole, but none of its tasks will be queued until you act on what holds it up"
		>
			<span className="inline-flex items-center gap-1.5">
				<TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
				<b>Stalled</b>
			</span>
			{holdups.map((holdup) => (
				<div
					key={holdup.id}
					className="flex flex-wrap items-center justify-between gap-2"
				>
					<span className="min-w-0">
						#{holdup.id} {HOLDUP[holdup.why]}
					</span>
					{QUEUEABLE.has(holdup.why) && (
						<Button
							size="sm"
							onClick={() =>
								void expect(
									queued(holdup.id, true),
									queueTodo(holdup.id, true),
								).catch((error: unknown) =>
									refuseTodo(holdup.id, "Not queued", error),
								)
							}
							{...still}
						>
							Queue #{holdup.id}
						</Button>
					)}
				</div>
			))}
		</section>
	);
}

/** Why a task holding up a stalled lane is not started, after its number. */
const HOLDUP: Record<Holdup["why"], string> = {
	skipped: "was taken out of the queue",
	manual: "is queued by hand only",
	unqueued: "is in a lane that is not queued",
	untriaged: "is in no lane",
	budget: "is in a lane whose budget is spent",
	lost: "waits on a task removed without merging: unlink it",
};

/** The holdups queueing the task itself clears. */
const QUEUEABLE = new Set<Holdup["why"]>([
	"skipped",
	"manual",
	"unqueued",
	"untriaged",
]);
