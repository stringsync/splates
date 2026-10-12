import { CheckIcon, FlagIcon, Loader2Icon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { After, ConversationState } from "../conversations";
import {
	checkpointProjects,
	dismissCheckpoint,
	listProjects,
	type ProjectChoice,
	type ProjectConversation,
	type Projects,
	restartFromCheckpoint,
	resumeCheckpoint,
} from "./api";
import { projectUrl } from "./projects";
import { Refusal, useRefusal } from "./refusal";
import { CheckpointState } from "./release";

/** What a checkpoint does once its agents have answered. */
const AFTERWARDS: { after: After; label: string; detail: string }[] = [
	{
		after: "stop",
		label: "Checkpoint",
		detail:
			"Each agent brings its ARBOR.md up to date and stops, then you pick what comes next.",
	},
	{
		after: "restart",
		label: "Checkpoint and restart",
		detail:
			"Then arbor dev restarts, on a newer arbor if one is out, and each carries on. Agents in projects left unpicked stop as they are.",
	},
];

/** How a checkpoint stands. */
interface Standing {
	asked: ProjectConversation[];
	/** Still to answer. */
	going: number;
	missed: ProjectConversation[];
}

function standing(conversations: ProjectConversation[]): Standing {
	const asked = conversations.filter((each) => each.checkpoint !== null);
	return {
		asked,
		going: asked.filter((each) => each.checkpoint === "asked").length,
		missed: asked.filter(
			(each) =>
				each.checkpoint === "failed" || each.checkpoint === "unanswered",
		),
	};
}

/**
 * Where the dialog is: picking projects, waiting on agents, done with them
 * stopped, waiting on `arbor dev` to restart, or ended with them carrying on.
 */
type Slide = "pick" | "going" | "done" | "restarting" | "ended";

function slideOf({ asked, going }: Standing): Slide {
	return asked.length === 0 ? "pick" : going > 0 ? "going" : "done";
}

/** A checkpoint whose agents carried on, after `arbor dev` restarted or not. */
interface Ended {
	projects: ProjectChoice[];
	/** The arbor it restarted on; null when it did not restart. */
	restarted: string | null;
}

/** How long a checkpoint whose agents carried on still says it is done. */
const ENDED = Duration.mins(1);

/** The projects the dialog offers: those with agents running. */
function offered(projects: ProjectChoice[]): ProjectChoice[] {
	return projects.filter((each) => !each.gone && each.conversations.length > 0);
}

/**
 * The sidebar's Checkpoint, opening, as ⌥⌘C does, a dialog to checkpoint any of the
 * projects with agents running, which says how one under way gets on, then
 * slides on to what to do once it is done, or to `arbor dev` restarting
 * when that was asked for. The button says how it stands, so the dialog can
 * be closed meanwhile and opened again from it, and still says it is done,
 * or restarted, for a minute after its agents carry on. Asks the server for
 * every project again as `conversations`, this project's, change, and each
 * second while a checkpoint or restart is under way or the dialog is open.
 */
export function CheckpointButton({
	conversations,
	held = false,
}: {
	conversations: ConversationState[];
	/** Whether ⌥⌘ is held, to show the key that opens it with ⌥⌘. */
	held?: boolean;
}): JSX.Element {
	const [listed, setListed] = useState<Projects | null>(null);
	const [open, setOpen] = useState(false);
	// ⌥⌘C (Ctrl+Alt+C off a Mac), by the key's place, since Alt types another
	// letter on a Mac.
	useEffect(() => {
		const press = (event: KeyboardEvent) => {
			if (
				event.code === "KeyC" &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				setOpen(true);
			}
		};
		document.addEventListener("keydown", press);
		return () => document.removeEventListener("keydown", press);
	}, []);
	// The checkpoint that ended last, while it says so.
	const [ended, setEnded] = useState<Ended | null>(null);
	// The run of `arbor dev` a restart is to replace, once one is coming.
	const [restarting, setRestarting] = useState<string | null>(null);
	// Those of the checkpoint under way or done, for when it ends.
	const last = useRef<ProjectChoice[]>([]);
	// Closed once done, so its end says nothing, stopped as its agents are.
	const forgotten = useRef(false);
	// Back from a restart, while its agents have yet to be told to carry on.
	const back = useRef(false);
	// Whether the server stopped answering, as while it restarts.
	const [unreachable, setUnreachable] = useState(false);
	const { refusal, refuse } = useRefusal();
	const load = useCallback(
		() =>
			listProjects().then(
				(next) => {
					setListed(next);
					setUnreachable(false);
				},
				(error: unknown) => {
					// The next ask finds it once it is back.
					if (error instanceof TypeError) {
						setUnreachable(true);
					} else {
						refuse("Projects not listed", error);
					}
				},
			),
		[refuse],
	);
	// A change here is the one the page hears of; others come by asking.
	const here = conversations
		.map((each) => `${each.id}:${each.status}:${each.checkpoint}`)
		.join();
	useEffect(() => {
		void here;
		void load();
	}, [here, load]);
	const shown = offered(listed?.projects ?? []);
	const all = standing(shown.flatMap((each) => each.conversations));
	const live = slideOf(all);
	// Gone to restart, its agents have answered, if not as the page last saw.
	const slide: Slide =
		live === "going" && !(restarting !== null && unreachable)
			? "going"
			: ended !== null
				? "ended"
				: restarting !== null
					? "restarting"
					: // Back from a restart, its agents about to be told to carry on.
						live === "done" && back.current
						? "pick"
						: live;
	useEffect(() => {
		if (listed === null) {
			return;
		}
		const shown = offered(listed.projects);
		const live = slideOf(standing(shown.flatMap((each) => each.conversations)));
		if (restarting !== null && listed.run !== restarting) {
			setRestarting(null);
			setEnded({ projects: last.current, restarted: listed.running });
			back.current = true;
			return;
		}
		if (listed.restarting && restarting === null) {
			setRestarting(listed.run);
		}
		if (live === "going") {
			last.current = shown;
			back.current = false;
			setEnded(null);
		} else if (live === "done") {
			// Done still, until each agent back from the restart is told so.
			if (!back.current) {
				last.current = shown;
				setEnded(null);
			}
		} else {
			if (last.current.length > 0 && !forgotten.current && !back.current) {
				setEnded({ projects: last.current, restarted: null });
			}
			last.current = [];
			forgotten.current = false;
			back.current = false;
		}
	}, [listed, restarting]);
	useEffect(() => {
		if (ended === null) {
			return;
		}
		const shown = new SystemTimer().setTimeout(() => setEnded(null), ENDED);
		return () => shown.dispose();
	}, [ended]);
	useEffect(() => {
		if (all.going === 0 && !open && restarting === null) {
			return;
		}
		const tick = new SystemTimer().setInterval(
			() => void load(),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [all.going, open, restarting, load]);
	return (
		<>
			<button
				type="button"
				data-row
				onClick={() => setOpen(true)}
				className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
			>
				{slide === "going" || slide === "restarting" ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : slide === "pick" ? (
					<FlagIcon className="size-3.5" />
				) : (
					<CheckIcon className="size-3.5 text-success" />
				)}
				<span className="flex-1 truncate">{BUTTON[slide](ended)}</span>
				{held && (
					// Its own height, taller than the line, would push the rows below.
					<Kbd aria-hidden className="-my-0.5">
						C
					</Kbd>
				)}
			</button>
			<Refusal refusal={refusal} className="px-3 pb-1.5" />
			<CheckpointDialog
				open={open}
				onClose={() => {
					setOpen(false);
					// Seen, so the button is free for the next one.
					if (slide === "ended") {
						setEnded(null);
					}
				}}
				onForget={() => {
					forgotten.current = true;
				}}
				onRestart={() => setRestarting(listed?.run ?? null)}
				projects={slide === "ended" ? (ended?.projects ?? []) : shown}
				slide={slide}
				restarting={restarting !== null}
				ended={ended}
				newest={listed?.newest ?? null}
				current={listed?.projects ?? []}
				onChange={load}
			/>
		</>
	);
}

/** What the sidebar's button says on each slide. */
const BUTTON: Record<Slide, (ended: Ended | null) => string> = {
	pick: () => "Checkpoint",
	going: () => "Checkpoint under way",
	done: () => "Checkpoint done",
	restarting: () => "Restarting arbor dev",
	ended: (ended) =>
		ended?.restarted == null ? "Checkpoint done" : "arbor dev restarted",
};

/**
 * Picks projects to checkpoint and what follows, this one picked to start
 * with; then lists how each agent asked gets on; then, once all have
 * answered, offers to resume them, restart, or retry those it missed, or
 * says `arbor dev` is restarting when that was asked for; and once they
 * carry on, says so, and whether it restarted, while `ended`. Closing it
 * once done leaves the agents stopped and forgets the checkpoint.
 */
function CheckpointDialog({
	open,
	onClose,
	onForget,
	onRestart,
	projects,
	slide,
	restarting,
	ended,
	newest,
	current,
	onChange,
}: {
	open: boolean;
	onClose: () => void;
	/** Forgets a done checkpoint, whose agents stay stopped. */
	onForget: () => void;
	/** Says `arbor dev` is restarting, once asked to. */
	onRestart: () => void;
	projects: ProjectChoice[];
	slide: Slide;
	/** Whether a restart follows the checkpoint. */
	restarting: boolean;
	ended: Ended | null;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	/** The projects as the server lists them now, after a restart too. */
	current: ProjectChoice[];
	onChange: () => Promise<void>;
}): JSX.Element {
	const all = standing(projects.flatMap((each) => each.conversations));
	const carried = all.asked.filter((each) => back(current, each.id)).length;
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
	const restarted = ended?.restarted ?? null;
	// A restart follows the last answer at once, which the page may not see.
	const state =
		slide === "restarting"
			? (each: ProjectConversation) =>
					each.checkpoint === "asked" ? null : checkpointed(each)
			: slide === "ended"
				? (each: ProjectConversation) => {
						const now = current
							.flatMap((one) => one.conversations)
							.find((one) => one.id === each.id);
						return back(current, each.id) ? (
							<CarriedOn />
						) : now === undefined ? null : (
							checkpointed(now)
						);
					}
				: checkpointed;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="sm:max-w-md">
				{/* Keyed, so each slide comes in on its own; ended is done still. */}
				<div
					key={slide === "ended" && restarted === null ? "done" : slide}
					className="grid gap-4 duration-200 animate-in fade-in-0 slide-in-from-right-8"
				>
					{slide === "pick" ? (
						<PickSlide
							projects={projects}
							onClose={onClose}
							onAsk={(go, after) =>
								act(() => checkpointProjects(go, after), "Not checkpointed")
							}
						/>
					) : (
						<>
							<DialogHeader>
								<DialogTitle>
									{slide === "going"
										? "Checkpoint under way"
										: slide === "restarting"
											? "Restarting arbor dev"
											: restarted !== null
												? "arbor dev restarted"
												: "Checkpoint done"}
								</DialogTitle>
								<DialogDescription>
									{slide === "going"
										? `Each agent is bringing its ARBOR.md up to date${restarting ? ", then arbor dev restarts" : ""}.`
										: slide === "restarting"
											? `arbor dev is restarting${newest === null ? "" : ` on arbor ${newest}`}, and each agent carries on once it is back.`
											: restarted !== null
												? `Now on arbor ${restarted}. ${carried === all.asked.length ? `${plural(carried)} carried on.` : `${carried} of ${plural(all.asked.length)} carried on so far.`}`
												: summary(
														all,
														slide === "ended" ? "carried on" : "stopped",
													)}
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
									onClose={close}
									onRestart={() =>
										act(
											() => restartFromCheckpoint().then(onRestart),
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

/** What a done checkpoint came to, in a sentence, its agents `then`. */
function summary(
	{ asked, missed }: Standing,
	then: "stopped" | "carried on",
): string {
	const said = `${plural(asked.length - missed.length)} checkpointed and ${then}.`;
	return missed.length === 0
		? said
		: `${said} ${missed.length} missed: ${missed.map((each) => each.name).join(", ")}.`;
}

/** `count` agents, in words. */
function plural(count: number): string {
	return `${count} ${count === 1 ? "agent" : "agents"}`;
}

/** The projects to pick, with what follows, and the button that asks. */
function PickSlide({
	projects,
	onClose,
	onAsk,
}: {
	projects: ProjectChoice[];
	onClose: () => void;
	onAsk: (projects: string[], after: After) => Promise<void>;
}): JSX.Element {
	const [picked, setPicked] = useState<Set<string> | null>(null);
	const [after, setAfter] = useState<After>("stop");
	// This project to start with, once the dialog knows which there are.
	const chosen =
		picked ??
		new Set(projects.filter((each) => each.here).map((each) => each.slug));
	const toggle = (slug: string) => {
		const next = new Set(chosen);
		if (!next.delete(slug)) {
			next.add(slug);
		}
		setPicked(next);
	};
	const go = [...chosen].filter((slug) =>
		projects.some((each) => each.slug === slug),
	);
	return (
		<>
			<DialogHeader>
				<DialogTitle>Checkpoint</DialogTitle>
				<DialogDescription>
					Each agent in the projects you pick brings its ARBOR.md up to date, so
					the next one can carry on from it.
				</DialogDescription>
			</DialogHeader>
			{projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">No agent is running.</p>
			) : (
				<>
					<ul aria-label="projects" className="flex flex-col gap-1">
						{projects.map((project) => (
							<li key={project.slug}>
								<label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
									<input
										type="checkbox"
										aria-label={`Checkpoint ${project.slug}`}
										checked={chosen.has(project.slug)}
										onChange={() => toggle(project.slug)}
										className="accent-primary"
									/>
									<ProjectName project={project} />
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{project.conversations.length} live
									</span>
								</label>
							</li>
						))}
					</ul>
					<fieldset className="flex flex-col gap-1">
						<legend className="mb-1 text-muted-foreground text-xs">Then</legend>
						{AFTERWARDS.map((each) => (
							<label
								key={each.after}
								className={cn(
									"flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
									after === each.after && "border-primary bg-accent",
								)}
							>
								<input
									type="radio"
									name="after"
									value={each.after}
									checked={after === each.after}
									onChange={() => setAfter(each.after)}
									className="mt-1 accent-primary"
								/>
								<span className="flex flex-col gap-0.5">
									<span className="text-sm">{each.label}</span>
									<span className="text-muted-foreground text-xs">
										{each.detail}
									</span>
								</span>
							</label>
						))}
					</fieldset>
				</>
			)}
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
				{projects.length > 0 && (
					<Button
						disabled={go.length === 0}
						onClick={() => void onAsk(go, after)}
					>
						{go.length > 1 ? `Checkpoint ${go.length} projects` : "Checkpoint"}
						{after === "restart" && " and restart"}
					</Button>
				)}
			</DialogFooter>
		</>
	);
}

/** The Done slide's way on: resume, restart, retry those missed, or close. */
function DoneActions({
	standing: { asked, missed },
	projects,
	busy,
	newest,
	onClose,
	onRestart,
	act,
}: {
	standing: Standing;
	projects: ProjectChoice[];
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
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
			{missed.length > 0 && (
				<Button variant="outline" disabled={busy} onClick={() => void retry()}>
					Retry missed
				</Button>
			)}
			<Button
				variant="outline"
				disabled={busy}
				onClick={() => void onRestart()}
			>
				{newest === null ? "Restart" : `Restart on ${newest}`}
			</Button>
			{done > 0 && (
				<Button
					disabled={busy}
					onClick={() => void act(resumeCheckpoint, "Not resumed")}
				>
					Resume
				</Button>
			)}
		</DialogFooter>
	);
}

/** Each project's agents a checkpoint asked, and how each got on. */
function AskedList({
	projects,
	onOpen,
	state,
}: {
	projects: ProjectChoice[];
	onOpen: () => void;
	/** How one got on, in a word. */
	state: (conversation: ProjectConversation) => JSX.Element | null;
}): JSX.Element {
	return (
		<ul aria-label="agents" className="flex flex-col gap-2">
			{projects.map((project) => {
				const { asked } = standing(project.conversations);
				if (asked.length === 0) {
					return null;
				}
				const href = (id: string) => {
					const url = new URL(projectUrl(project));
					url.hash = `#conversations/${id}`;
					return url.toString();
				};
				return (
					<li key={project.slug} className="flex flex-col gap-0.5">
						<span className="flex px-1.5">
							<ProjectName project={project} />
						</span>
						<ul className="flex flex-col">
							{asked.map((each) => (
								<li key={each.id}>
									<a
										href={href(each.id)}
										onClick={onOpen}
										className="flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate">{each.name}</span>
										{state(each)}
									</a>
								</li>
							))}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}

/** Where one's checkpoint stands, if it has one. */
function checkpointed({ checkpoint }: ProjectConversation): JSX.Element | null {
	return checkpoint === null ? null : (
		<CheckpointState checkpoint={checkpoint} />
	);
}

/** Said of an agent back at work since `arbor dev` restarted. */
function CarriedOn(): JSX.Element {
	return (
		<span className="flex shrink-0 items-center gap-1 self-center text-success text-xs">
			<CheckIcon className="size-3" />
			Carried on
		</span>
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

function ProjectName({ project }: { project: ProjectChoice }): JSX.Element {
	return (
		<span className="flex min-w-0 flex-1 items-baseline gap-2">
			<span className="truncate font-medium text-sm">{project.slug}</span>
			{project.here && (
				<span className="shrink-0 text-muted-foreground text-xs">
					this project
				</span>
			)}
		</span>
	);
}
