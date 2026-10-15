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
 * Power's first slide: restart or shut down `arbor dev`, every agent at work
 * checkpointing first while `checkpoint` is ticked, and resuming after a
 * restart; unticked, saying what going on stops as it is.
 */
export function PickSlide({
	projects,
	checkpoint,
	onCheckpoint,
	busy,
	newest,
	restartable,
	held,
	onClose,
	onPower,
}: {
	/** The projects with agents at work. */
	projects: ProjectChoice[];
	checkpoint: boolean;
	onCheckpoint: (checkpoint: boolean) => void;
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	restartable: boolean;
	/** The commands a restart or shutdown would kill. */
	held: Held[];
	onClose: () => void;
	/** Restarts, or with `shutdown` shuts down, checkpointing first when ticked. */
	onPower: (shutdown: boolean) => Promise<void>;
}): JSX.Element {
	const working = projects.flatMap((each) => each.conversations);
	const checkpointing = working.length > 0 && checkpoint;
	return (
		<>
			<DialogHeader>
				<PowerTitle title="Power" />
				<DialogDescription>
					{working.length === 0
						? "No agent is running."
						: `${plural(working.length)} at work in ${projects.length === 1 ? "1 project" : `${projects.length} projects`}.`}
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
					Checkpoint first
				</label>
			)}
			{restartable &&
				((!checkpointing && working.length > 0) || held.length > 0) && (
					<Stops
						agents={checkpointing ? [] : working.map((each) => each.name)}
						held={held}
					/>
				)}
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
							{newest === null ? "Restart" : `Restart on ${newest}`}
						</Button>
					</>
				)}
			</DialogFooter>
		</>
	);
}

/** What going on without a checkpoint stops as it is. */
function Stops({
	agents,
	held,
}: {
	agents: string[];
	held: Held[];
}): JSX.Element {
	return (
		<div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
			<TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
			<span className="flex flex-col gap-0.5">
				{agents.length > 0 && <span>Stops mid-turn: {agents.join(", ")}.</span>}
				{held.length > 0 && (
					<span>
						Kills:{" "}
						{held.map((each) => `${each.command} (${each.where})`).join(", ")}.
					</span>
				)}
			</span>
		</div>
	);
}
