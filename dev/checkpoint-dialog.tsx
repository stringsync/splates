import { type JSX, useState } from "react";
import type { Duration } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
} from "#dev/components/ui/dialog.tsx";
import type { Held } from "../held";
import { MissedList } from "./checkpoint-asked";
import { PickSlide } from "./checkpoint-pick";
import {
	PowerTitle,
	plural,
	type Run,
	type Slide,
	Steps,
	standing,
	stepsOf,
} from "./checkpoint-slide";
import {
	checkpointProjects,
	type ProjectChoice,
	powerNow,
} from "./project-api";
import { Refusal, useRefusal } from "./refusal";

/**
 * A restart on its way: the run it replaces, and whether the next resumes,
 * or whether it shuts down instead.
 */
export interface Restarting {
	run: string;
	resume: boolean;
	shutdown: boolean;
}

/** An auto update counting down: how long is left, and what it brings. */
export interface Countdown {
	left: Duration;
	onto: string;
}

/**
 * Power: restarts `arbor dev` at once, its agents on a worker carrying on
 * through it, or shuts it down, checkpointing every agent at work first
 * unless unticked, or counts down to an auto update, which can be cancelled
 * or done now; then one screen for the whole run, its title held throughout,
 * its steps in a line with the one under way spinning, a sentence on where
 * it is, and only the agents that missed. Agents a checkpoint stopped carry
 * on by themselves on the next start, or after a restart asked for over the
 * API.
 */
export function CheckpointDialog({
	open,
	checkpoint,
	onCheckpoint,
	onClose,
	onRestart,
	projects,
	slide,
	restarting,
	run,
	title,
	restarted,
	from,
	onto,
	current,
	restartable,
	held,
	updating = false,
	countdown,
	onCancel,
	onRestartNow,
	onChange,
}: {
	open: boolean;
	/** Whether a shutdown checkpoints first, as picked. */
	checkpoint: boolean;
	onCheckpoint: (checkpoint: boolean) => void;
	onClose: () => void;
	/** Says `arbor dev` is restarting, or with `shutdown` shutting down, once asked to. */
	onRestart: (shutdown?: boolean) => void;
	projects: ProjectChoice[];
	slide: Slide;
	/** The restart to follow the checkpoint, if any. */
	restarting: Restarting | null;
	run: Run;
	/** What the run is called, the menu item saying the same. */
	title: string;
	/** The arbor a restart came back on; null when none did. */
	restarted: string | null;
	/** The arbor the restart left; null when unknown. */
	from: string | null;
	/** A newer arbor, which a restart lands on. */
	onto: string | null;
	/** The projects as the server lists them now, after a restart too. */
	current: ProjectChoice[];
	/** Whether `arbor dev` can restart itself. */
	restartable: boolean;
	/** The commands a restart would kill. */
	held: Held[];
	/** Whether this run is an automatic update, which restarts to pick up newer arbor. */
	updating?: boolean;
	/** The auto update counting down, on the `counting` slide. */
	countdown: Countdown | null;
	/** Cancels the countdown. */
	onCancel: () => void;
	/** Restarts at once rather than at the end of the countdown. */
	onRestartNow: () => void;
	onChange: () => Promise<void>;
}): JSX.Element {
	const all = standing(projects.flatMap((each) => each.conversations));
	// Those told to carry on, and how many of them have.
	const resumable = all.asked.filter((each) => !all.missed.includes(each));
	const carried = resumable.filter((each) => back(current, each.id)).length;
	const { refusal, refuse } = useRefusal();
	const [busy, setBusy] = useState(false);
	/** Does `write`, then asks again, saying why when refused. */
	const act = (write: () => Promise<void>, failed: string) => {
		setBusy(true);
		return write()
			.then(onChange, (error: unknown) => refuse(failed, error))
			.finally(() => setBusy(false));
	};
	const resumes =
		restarting?.resume === true || slide === "resuming" || slide === "ended";
	const steps = stepsOf(slide, run, {
		checkpointed: all.asked.length > 0,
		resumes,
	}).map((step) =>
		updating && step.label === "Restart" ? { ...step, label: "Update" } : step,
	);
	const said =
		slide === "counting" && countdown !== null
			? `arbor dev will update to ${countdown.onto}. You and the agents this update would interrupt have been idle for a minute. Updating restarts arbor dev, then reloads this page.`
			: slide === "going"
				? `${all.asked.length - all.going - all.missed.length} of ${plural(all.asked.length)} checkpointed.`
				: slide === "restarting"
					? `arbor dev is ${updating ? "updating" : "restarting"}${onto === null ? "" : `${updating ? " to " : " on "}${onto}`}. This page reloads once it is back.`
					: slide === "resuming"
						? `${carried} of ${plural(resumable.length)} back at work.`
						: slide === "ended"
							? `${plural(carried)} back at work.`
							: slide === "restarted"
								? "arbor dev is back."
								: slide === "shuttingDown"
									? "arbor dev is shutting down."
									: slide === "shutDown"
										? all.asked.length > 0
											? "Start arbor dev again to resume the agents."
											: "Start arbor dev again from a terminal."
										: `${plural(resumable.length)} checkpointed.`;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-md">
				{/* Keyed, so the run comes in once and stays in place as its
				    steps move on. */}
				<div
					key={slide === "pick" ? "pick" : "run"}
					className="grid gap-4 duration-200 animate-in fade-in-0 slide-in-from-right-8"
				>
					{slide === "pick" ? (
						<PickSlide
							projects={projects}
							checkpoint={checkpoint}
							onCheckpoint={onCheckpoint}
							busy={busy}
							onto={onto}
							restartable={restartable}
							held={held}
							onClose={onClose}
							onPower={(shutdown) =>
								shutdown && projects.length > 0 && checkpoint
									? act(
											() =>
												checkpointProjects(
													projects.map((each) => each.slug),
													"shutdown",
												),
											"Not checkpointed",
										)
									: act(
											() => powerNow(shutdown).then(() => onRestart(shutdown)),
											shutdown ? "Not shut down" : "Not restarted",
										)
							}
						/>
					) : (
						<>
							<DialogHeader>
								<PowerTitle
									title={
										slide === "counting" && countdown !== null ? (
											<>
												{title} in{" "}
												<span className="tabular-nums">
													{clock(countdown.left.ms)}
												</span>
											</>
										) : (
											title
										)
									}
								/>
								<DialogDescription>{said}</DialogDescription>
							</DialogHeader>
							<Steps steps={steps} />
							{restarted !== null && (
								<Version running={restarted} from={from} />
							)}
							<MissedList projects={projects} onOpen={onClose} />
							<Refusal refusal={refusal} />
							<DialogFooter>
								{slide === "counting" ? (
									<>
										<Button variant="outline" onClick={onCancel}>
											Cancel
										</Button>
										<Button onClick={onRestartNow}>Update now</Button>
									</>
								) : (
									<Button variant="outline" disabled={busy} onClick={onClose}>
										Close
									</Button>
								)}
							</DialogFooter>
						</>
					)}
				</div>
				{slide === "pick" && <Refusal refusal={refusal} />}
			</DialogContent>
		</Dialog>
	);
}

/**
 * The arbor a restart came back on, plainly, and the one it left when that
 * differs.
 */
function Version({
	running,
	from,
}: {
	running: string;
	from: string | null;
}): JSX.Element {
	return (
		<div className="rounded-md border bg-muted/40 px-3 py-2">
			<p className="text-muted-foreground text-xs">Now running</p>
			<p className="font-medium">arbor {running}</p>
			{from !== null && from !== running && (
				<p className="text-muted-foreground text-xs">
					Updated from arbor {from}
				</p>
			)}
		</div>
	);
}

/** `ms` as minutes and seconds, rounded up, as a countdown shows it. */
function clock(ms: number): string {
	const secs = Math.ceil(ms / 1000);
	return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** Whether `conversation` is back at work, as `current` lists it. */
function back(current: ProjectChoice[], id: string): boolean {
	const found = current
		.flatMap((each) => each.conversations)
		.find((each) => each.id === id);
	return (
		found !== undefined &&
		found.status !== "stopped" &&
		found.status !== "failed"
	);
}
