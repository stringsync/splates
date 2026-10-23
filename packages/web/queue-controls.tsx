import type { WorkerPool } from "@stringsync/splates-server/workers";
import {
	InfoIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { LOCAL, localWorker, localWorkerOn } from "./local-worker";
import { Refusal, useRefusal } from "./refusal";
import type { WorkerPoolView } from "./worker-pool";

/** Why the limit is no cap on the person, behind the ⓘ beside it. */
export const NOT_YOURS =
	"Agents you start, and the tasks you queue, start at once and take no slot. The limit holds back only what automations, hooks and the groomer start.";

/**
 * What splates starts on its own and how many at once, atop the Queue
 * page: Pause, or Resume while paused, how many agents may run at once, and
 * a line on how that stands now.
 */
export function QueueControls({
	view,
	pool,
	waiting,
}: {
	view: WorkerPoolView;
	pool: WorkerPool;
	/** How many agents wait for a slot. */
	waiting: number;
}): JSX.Element {
	const { refusal, refuse } = useRefusal();
	const local = localWorker(pool);
	const paused = pausedIn(pool);
	const total = local?.slots.total ?? null;
	const running = slotsHeld(pool);
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
	const setTotal = (slots: number) =>
		void view
			.change(LOCAL, { slots })
			.catch((error: unknown) => refuse("Not changed", error));
	return (
		<section
			aria-label="queue controls"
			className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-2.5 shadow-xs"
		>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<Button
					size="sm"
					variant={paused ? "default" : "outline"}
					onClick={toggle}
				>
					{paused ? <PlayIcon /> : <PauseIcon />}
					{paused ? "Resume" : "Pause"}
				</Button>
				<span className="flex items-center gap-2 text-sm">
					<span id="agents-at-once">Agents at once</span>
					<fieldset
						aria-labelledby="agents-at-once"
						className="m-0 flex min-w-0 items-center rounded-lg border p-0"
					>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Fewer at once"
							disabled={total === null || total <= 1}
							onClick={() => total !== null && setTotal(total - 1)}
						>
							<MinusIcon />
						</Button>
						<span className="w-6 text-center font-medium text-sm tabular-nums">
							{total ?? "…"}
						</span>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="More at once"
							disabled={total === null}
							onClick={() => total !== null && setTotal(total + 1)}
						>
							<PlusIcon />
						</Button>
					</fieldset>
					<Popover>
						<PopoverTrigger
							render={
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label="What the limit holds back"
									className="text-muted-foreground"
								/>
							}
						>
							<InfoIcon />
						</PopoverTrigger>
						<PopoverContent align="start" className="w-72 text-sm">
							{NOT_YOURS}
						</PopoverContent>
					</Popover>
				</span>
				<span
					role="status"
					className="text-muted-foreground text-sm max-md:basis-full"
				>
					{standing({ paused, running, total, waiting })}
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

/** How many agents hold a slot that counts against the limit. */
export function slotsHeld(pool: WorkerPool): number {
	return pool.held.filter((held) => held.capped).length;
}

/** The line beside the controls, kept to one line. */
export function standing({
	paused,
	running,
	total,
	waiting,
}: {
	paused: boolean;
	running: number;
	total: number | null;
	waiting: number;
}): string {
	if (paused) {
		return running === 0
			? "Paused · yours still start"
			: `Paused · ${running} running finish · yours still start`;
	}
	if (total !== null && running > total) {
		return `${running} running, over the limit · new ones wait until under ${total}`;
	}
	const of = total === null ? `${running}` : `${running} of ${total}`;
	return waiting === 0 ? `${of} running` : `${of} running · ${waiting} waiting`;
}
