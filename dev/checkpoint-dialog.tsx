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
import {
	AskedList,
	CheckpointResumed,
	checkpointed,
	Resuming,
} from "./checkpoint-asked";
import { PickSlide } from "./checkpoint-pick";
import {
	missing,
	PhaseTitle,
	plural,
	type Slide,
	type Standing,
	standing,
	summary,
} from "./checkpoint-slide";
import {
	checkpointProjects,
	dismissCheckpoint,
	type ProjectChoice,
	type ProjectConversation,
	powerNow,
	restartFromCheckpoint,
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
 * work first unless unticked, and resuming them after a restart; then lists how each agent asked gets on; then, once all have
 * answered, offers to resume them, restart, or retry those it missed; or
 * says `arbor dev` is restarting when that was asked for, then offers to
 * resume them after it, or shows each carry on; and once they have, says
 * so, while `ended`. Closing it once done leaves the agents stopped and
 * forgets the checkpoint.
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
	// A restart follows the last answer at once, which the page may not see.
	const state =
		slide === "restarting" || slide === "shuttingDown" || slide === "shutDown"
			? (each: ProjectConversation) =>
					each.checkpoint === "asked" ? null : checkpointed(each)
			: slide === "resuming" || slide === "ended"
				? (each: ProjectConversation) =>
						all.missed.includes(each) ? (
							checkpointed(each)
						) : back(current, each.id) ? (
							<CheckpointResumed />
						) : (
							<Resuming />
						)
				: checkpointed;
	const on = (version: string | null) =>
		version === null ? "" : ` on arbor ${version}`;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="sm:max-w-md">
				{/* Keyed, so each slide comes in on its own; ended is resuming
				    once all are back, so it stays in place. */}
				<div
					key={slide === "ended" ? "resuming" : slide}
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
								<PhaseTitle slide={slide} restarted={restarted} />
								<DialogDescription>
									{slide === "going"
										? `Each agent is bringing its ARBOR.md up to date${restarting === null ? "" : restarting.shutdown ? ", then arbor dev shuts down" : restarting.resume ? ", then arbor dev restarts and each resumes" : ", then arbor dev restarts"}.`
										: slide === "shuttingDown"
											? "arbor dev is shutting down."
											: slide === "shutDown"
												? `arbor dev shut down.${all.asked.length > 0 ? " Start it again to resume each agent." : ""}`
												: slide === "restarting"
													? `arbor dev is restarting${on(newest)}${restarting?.resume ? ", then each agent resumes" : all.asked.length > 0 ? ", then you pick what comes next" : ""}, and this page reloads.`
													: slide === "restarted"
														? `arbor dev restarted${on(restarted)}.`
														: slide === "resuming" || slide === "ended"
															? `${restarted === null ? "" : `Now${on(restarted)}. `}${carried === resumable.length ? `${plural(carried)} resumed.` : `${carried} of ${plural(resumable.length)} resumed so far.`}${missing(all)}`
															: restarted !== null
																? `Now${on(restarted)}. ${summary(all, "waiting to resume")}`
																: summary(all, "stopped")}
								</DialogDescription>
							</DialogHeader>
							<AskedList projects={projects} onOpen={onClose} state={state} />
							<Refusal refusal={refusal} />
							{slide !== "done" ? (
								<DialogFooter>
									<Button variant="outline" onClick={onClose}>
										Close
									</Button>
								</DialogFooter>
							) : (
								<DoneActions
									standing={all}
									projects={projects}
									busy={busy}
									newest={newest}
									restarted={restarted !== null}
									onClose={close}
									onRestart={() =>
										act(
											() => restartFromCheckpoint().then(() => onRestart()),
											"Not restarted",
										)
									}
									act={act}
								/>
							)}
						</>
					)}
				</div>
				{slide === "pick" && <Refusal refusal={refusal} />}
			</DialogContent>
		</Dialog>
	);
}

/**
 * The Done slide's way on: resume, restart, retry those missed, or close;
 * once `restarted`, only resume or close.
 */
function DoneActions({
	standing: { asked, missed },
	projects,
	busy,
	newest,
	restarted,
	onClose,
	onRestart,
	act,
}: {
	standing: Standing;
	projects: ProjectChoice[];
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	/** Back from the restart that followed the checkpoint. */
	restarted: boolean;
	onClose: () => void;
	onRestart: () => Promise<void>;
	act: (write: () => Promise<void>, failed: string) => Promise<void>;
}): JSX.Element {
	const retry = () => {
		const ids = new Set(missed.map((each) => each.id));
		const slugs = projects
			.filter((each) => each.conversations.some((one) => ids.has(one.id)))
			.map((each) => each.slug);
		return act(
			() => checkpointProjects(slugs, "stop", [...ids]),
			"Not checkpointed",
		);
	};
	const done = asked.length - missed.length;
	return (
		<DialogFooter>
			<Button variant="outline" disabled={busy} onClick={onClose}>
				Close
			</Button>
			{missed.length > 0 && !restarted && (
				<Button variant="outline" disabled={busy} onClick={() => void retry()}>
					Retry missed
				</Button>
			)}
			{!restarted && (
				<Button
					variant="outline"
					disabled={busy}
					onClick={() => void onRestart()}
				>
					{newest === null ? "Restart" : `Restart on ${newest}`}
				</Button>
			)}
			{done > 0 && (
				<Button
					disabled={busy}
					onClick={() => void act(resumeCheckpoint, "Not resumed")}
				>
					{done > 1 ? "Resume all" : "Resume"}
				</Button>
			)}
		</DialogFooter>
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
