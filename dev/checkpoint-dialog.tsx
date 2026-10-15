import { type JSX, useState } from "react";
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
	dismissCheckpoint,
	type ProjectChoice,
	powerNow,
	resumeCheckpoint,
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

/**
 * Power: restarts or shuts down `arbor dev`, checkpointing every agent at
 * work first unless unticked, and resuming them after a restart; then one
 * screen for the whole run, its title held throughout, its steps in a line
 * with the one under way spinning, a sentence on where it is, and only the
 * agents that missed. A checkpoint left done, its agents stopped, offers to
 * resume them; closing it then forgets the checkpoint.
 */
export function CheckpointDialog({
	open,
	checkpoint,
	onCheckpoint,
	onClose,
	onForget,
	onRestart,
	projects,
	slide,
	restarting,
	run,
	title,
	restarted,
	newest,
	current,
	restartable,
	held,
	onChange,
}: {
	open: boolean;
	/** Whether a restart or shutdown checkpoints first, as picked. */
	checkpoint: boolean;
	onCheckpoint: (checkpoint: boolean) => void;
	onClose: () => void;
	/** Forgets a done checkpoint, whose agents stay stopped. */
	onForget: () => void;
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
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	/** The projects as the server lists them now, after a restart too. */
	current: ProjectChoice[];
	/** Whether `arbor dev` can restart itself. */
	restartable: boolean;
	/** The commands a restart would kill. */
	held: Held[];
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
	const close = () => {
		if (slide !== "done") {
			onClose();
			return;
		}
		const asked = projects.filter(
			(each) => standing(each.conversations).asked.length > 0,
		);
		onForget();
		void act(
			() =>
				Promise.all(asked.map((each) => dismissCheckpoint(each.slug))).then(
					() => {},
				),
			"Not dismissed",
		).then(onClose);
	};
	const resumes =
		restarting?.resume === true ||
		slide === "resuming" ||
		slide === "ended" ||
		(slide === "done" && restarted !== null);
	const steps = stepsOf(slide, run, {
		checkpointed: all.asked.length > 0,
		resumes,
	});
	const on = (version: string | null) =>
		version === null ? "" : `Now on arbor ${version}. `;
	const said =
		slide === "going"
			? `${all.asked.length - all.going - all.missed.length} of ${plural(all.asked.length)} checkpointed.`
			: slide === "restarting"
				? `arbor dev is restarting${newest === null ? "" : ` on arbor ${newest}`}. This page reloads once it is back.`
				: slide === "resuming"
					? `${on(restarted)}${carried} of ${plural(resumable.length)} back at work.`
					: slide === "ended"
						? `${on(restarted)}${plural(carried)} back at work.`
						: slide === "restarted"
							? on(restarted).trim()
							: slide === "shuttingDown"
								? "arbor dev is shutting down."
								: slide === "shutDown"
									? all.asked.length > 0
										? "Start arbor dev again to resume the agents."
										: "Start arbor dev again from a terminal."
									: restarted !== null
										? `${on(restarted)}${plural(resumable.length)} waiting to resume.`
										: `${plural(resumable.length)} checkpointed and stopped.`;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
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
							newest={newest}
							restartable={restartable}
							held={held}
							onClose={onClose}
							onPower={(shutdown) =>
								projects.length > 0 && checkpoint
									? act(
											() =>
												checkpointProjects(
													projects.map((each) => each.slug),
													shutdown ? "shutdown" : "resume",
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
								<PowerTitle title={title} />
								<DialogDescription>{said}</DialogDescription>
							</DialogHeader>
							<Steps steps={steps} />
							<MissedList projects={projects} onOpen={onClose} />
							<Refusal refusal={refusal} />
							<DialogFooter>
								<Button variant="outline" disabled={busy} onClick={close}>
									Close
								</Button>
								{slide === "done" && resumable.length > 0 && (
									<Button
										disabled={busy}
										onClick={() => void act(resumeCheckpoint, "Not resumed")}
									>
										Resume
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
