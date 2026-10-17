import { TriangleAlertIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTrigger,
} from "#dev/components/ui/dialog.tsx";
import type { Held } from "../held";
import { PowerTitle, plural } from "./checkpoint-slide";
import type { ProjectChoice } from "./project-api";

/**
 * Power's first slide: restart or shut down `arbor dev`. A restart is at
 * once, and keeps every agent at work on a worker. Shutdown opens a
 * confirmation with the choice to checkpoint first.
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
	const [confirming, setConfirming] = useState(false);
	const working = projects.flatMap((each) => each.conversations);
	// What a restart stops: those off a worker.
	const dies = working.filter((each) => !each.survives);
	const stops = lines({
		agents: dies.map((each) => each.name),
		action: "Restart",
		held,
	});
	const shutdownStops = lines({
		agents: checkpoint ? [] : working.map((each) => each.name),
		action: "Shutdown",
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
			{restartable && stops.length > 0 && <Stops lines={stops} />}
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
				{restartable && (
					<>
						<Dialog open={confirming} onOpenChange={setConfirming}>
							<DialogTrigger
								render={<Button variant="outline" disabled={busy} />}
							>
								Shut down
							</DialogTrigger>
							<DialogContent showCloseButton={false}>
								<DialogHeader>
									<PowerTitle title="Shut down arbor dev?" />
									<DialogDescription>
										This stops arbor dev and all running agents. You will need
										to start arbor dev again from a terminal.
									</DialogDescription>
								</DialogHeader>
								{working.length > 0 && (
									<label className="flex cursor-pointer items-center gap-2.5 text-sm">
										<input
											type="checkbox"
											disabled={busy}
											checked={checkpoint}
											onChange={(event) => onCheckpoint(event.target.checked)}
											className="accent-primary"
										/>
										Checkpoint before shutting down
									</label>
								)}
								{shutdownStops.length > 0 && <Stops lines={shutdownStops} />}
								<DialogFooter>
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => setConfirming(false)}
										autoFocus
									>
										Cancel
									</Button>
									<Button
										variant="destructive"
										disabled={busy}
										onClick={() => {
											setConfirming(false);
											void onPower(true);
										}}
									>
										Shut down
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						<Button disabled={busy} onClick={() => void onPower(false)}>
							{onto === null ? "Restart" : `Restart on ${onto}`}
						</Button>
					</>
				)}
			</DialogFooter>
		</>
	);
}

/** The agents and commands this action stops without a checkpoint. */
function lines({
	agents,
	action,
	held,
}: {
	agents: string[];
	action: "Restart" | "Shutdown";
	held: Held[];
}): string[] {
	return [
		...(agents.length > 0
			? [`${action} stops mid-turn: ${agents.join(", ")}.`]
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
