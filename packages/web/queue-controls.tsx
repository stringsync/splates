import type { WorkerPool } from "@stringsync/splates-server/workers";
import { useReactive } from "@webappwiz/react";
import { InfoIcon, PauseIcon, PlayIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { LOCAL, localWorker, localWorkerOn } from "./local-worker";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import type { WorkerPoolView } from "./worker-pool";

/** What Pause holds back and what it leaves, which the ⓘ beside Pause explains. */
export const PAUSE_HOLDS =
	"Nothing caps how many agents run; merges take turns and agents ask before other heavy work. Pause holds back what splates starts on its own: the queue, automations, hooks and the groomer. Agents you start still start.";

/**
 * What splates starts on its own, atop the Queue page: Pause, or Resume
 * while paused, and a line on how many agents run and wait.
 */
export function QueueControls({
	view,
	pool,
	waiting,
}: {
	view: WorkerPoolView;
	pool: WorkerPool;
	/** How many agents wait to start. */
	waiting: number;
}): JSX.Element {
	const { refusal, refuse } = useRefusal();
	const { writing } = useReactive(
		view,
		(each) => ({ writing: each.writing > 0 }),
		["changed"],
	);
	const shown = useShowPending(writing);
	const local = localWorker(pool);
	const paused = pausedIn(pool);
	const running = pool.held.length;
	const toggle = () => {
		const resuming = paused;
		// Resuming turns this machine's worker back on too, for one turned off
		// on the Workers page before it went.
		const write = resuming
			? local !== null && localWorkerOn(pool)
				? view.pause(false)
				: view.change(LOCAL, { paused: false, draining: false })
			: view.pause(true);
		void write.catch((error: unknown) =>
			refuse(resuming ? "Not resumed" : "Not paused", error),
		);
	};
	return (
		<section
			aria-label="queue controls"
			className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-2.5 shadow-xs"
		>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<span className="flex items-center gap-1">
					<Button
						size="sm"
						variant={paused ? "default" : "outline"}
						disabled={writing}
						aria-busy={writing}
						onClick={toggle}
					>
						{writing ? (
							<PendingSpinner shown={shown} />
						) : paused ? (
							<PlayIcon />
						) : (
							<PauseIcon />
						)}
						{paused ? "Resume" : "Pause"}
					</Button>
					<Popover>
						<PopoverTrigger
							render={
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label="What Pause holds back"
									className="text-muted-foreground"
								/>
							}
						>
							<InfoIcon />
						</PopoverTrigger>
						<PopoverContent align="start" className="w-72 text-sm">
							{PAUSE_HOLDS}
						</PopoverContent>
					</Popover>
				</span>
				<span
					role="status"
					className="text-muted-foreground text-sm max-md:basis-full"
				>
					{standing({ paused, running, waiting })}
				</span>
			</div>
			<Refusal refusal={refusal} />
		</section>
	);
}

/**
 * Whether what splates starts on its own is held back: paused, or this
 * machine's worker turned off before the Workers page went.
 */
export function pausedIn(pool: WorkerPool): boolean {
	return pool.paused || !localWorkerOn(pool);
}

/** The line beside the controls, kept to one line. */
export function standing({
	paused,
	running,
	waiting,
}: {
	paused: boolean;
	/** How many agents run, every one, the person's own included. */
	running: number;
	waiting: number;
}): string {
	const line =
		waiting === 0
			? `${running} running`
			: `${running} running · ${waiting} waiting`;
	return paused ? `Paused · ${line} · yours still start` : line;
}
