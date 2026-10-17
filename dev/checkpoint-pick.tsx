import { TriangleAlertIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
} from "#dev/components/ui/dialog.tsx";
import type { Held } from "../held";
import { PowerTitle, plural } from "./checkpoint-slide";
import type { ProjectChoice } from "./project-api";

/**
 * Power's first slide: restart or shut down `arbor dev`. A restart is at
 * once, and keeps every agent at work on a worker; a shutdown stops them
 * all, every one checkpointing first while `checkpoint` is ticked. Says what
 * each stops as it is.
 */
export function PickSlide({
	projects,
	checkpoint,
	onCheckpoint,
	busy,
	onto,
	restartable,
	held,
	onClose,
	onPower,
}: {
	/** The projects with agents at work. */
	projects: ProjectChoice[];
	/** Whether a shutdown checkpoints first. */
	checkpoint: boolean;
	onCheckpoint: (checkpoint: boolean) => void;
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	onto: string | null;
	restartable: boolean;
	/** The commands a restart or shutdown would kill. */
	held: Held[];
	onClose: () => void;
	/** Restarts at once, or with `shutdown` shuts down, checkpointing first when ticked. */
	onPower: (shutdown: boolean) => Promise<void>;
}): JSX.Element {
	const working = projects.flatMap((each) => each.conversations);
	// What a restart stops: those off a worker.
	const dies = working.filter((each) => !each.survives);
	const checkpointing = working.length > 0 && checkpoint;
	const stops = lines({
		restart: dies.map((each) => each.name),
		shutdown: checkpointing ? [] : working.map((each) => each.name),
		held,
	});
	return (
		<>
			<DialogHeader>
				<PowerTitle title="Power" />
				<DialogDescription>
					{working.length === 0
						? "No agent is running."
						: `${plural(working.length)} at work in ${projects.length === 1 ? "1 project" : `${projects.length} projects`}.`}
					{working.length > 0 &&
						dies.length === 0 &&
						restartable &&
						" A restart keeps them at work."}
					{!restartable && " arbor dev cannot restart itself here."}
				</DialogDescription>
			</DialogHeader>
			{working.length > 0 && restartable && (
				<label className="flex cursor-pointer items-center gap-2.5 text-sm">
					<input
						type="checkbox"
						checked={checkpoint}
						onChange={(event) => onCheckpoint(event.target.checked)}
						className="accent-primary"
					/>
					Checkpoint before shutting down
				</label>
			)}
			{restartable && stops.length > 0 && <Stops lines={stops} />}
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
				{restartable && (
					<>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => void onPower(true)}
						>
							Shut down
						</Button>
						<Button disabled={busy} onClick={() => void onPower(false)}>
							{onto === null ? "Restart" : `Restart on ${onto}`}
						</Button>
					</>
				)}
			</DialogFooter>
		</>
	);
}

/**
 * What going on stops as it is, a line each: the agents a restart stops
 * mid-turn, those a shutdown without a checkpoint stops, as one line when
 * they are the same, and the commands either kills.
 */
function lines({
	restart,
	shutdown,
	held,
}: {
	restart: string[];
	shutdown: string[];
	held: Held[];
}): string[] {
	const same = restart.length === shutdown.length;
	return [
		...(restart.length > 0
			? [`${same ? "Stops" : "Restart stops"} mid-turn: ${restart.join(", ")}.`]
			: []),
		...(shutdown.length > 0 && !same
			? [`Shutdown stops mid-turn: ${shutdown.join(", ")}.`]
			: []),
		...(held.length > 0
			? [
					`Kills: ${held.map((each) => `${each.command} (${each.where})`).join(", ")}.`,
				]
			: []),
	];
}

function Stops({ lines }: { lines: string[] }): JSX.Element {
	return (
		<div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
			<TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
			<span className="flex flex-col gap-0.5">
				{lines.map((line) => (
					<span key={line}>{line}</span>
				))}
			</span>
		</div>
	);
}
