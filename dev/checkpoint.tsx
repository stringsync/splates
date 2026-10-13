import {
	CheckIcon,
	CircleAlertIcon,
	FlagIcon,
	Loader2Icon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import {
	DropdownMenuItem,
	DropdownMenuShortcut,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { After, Checkpoint, ConversationState } from "../conversations";
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

/** What a checkpoint does once its agents have answered. */
const AFTERWARDS: {
	after: After;
	label: string;
	detail: string;
}[] = [
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
			"Then arbor dev restarts, on a newer arbor if one is out, and you pick what comes next.",
	},
	{
		after: "resume",
		label: "Checkpoint, restart and resume",
		detail:
			"Then arbor dev restarts, on a newer arbor if one is out, and each agent resumes.",
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
 * stopped, waiting on `arbor dev` to restart, its agents being told to carry
 * on after the restart, or ended with them carrying on.
 */
type Slide = "pick" | "going" | "done" | "restarting" | "resuming" | "ended";

function slideOf({ asked, going }: Standing): Slide {
	return asked.length === 0 ? "pick" : going > 0 ? "going" : "done";
}

/**
 * Each slide's title, its own so moving on is plain to see; done says
 * `arbor dev` restarted when its agents wait to resume on the new run.
 */
function titleOf(slide: Slide, restarted: string | null): string {
	switch (slide) {
		case "pick":
			return "Checkpoint";
		case "going":
			return "Checkpoint under way";
		case "done":
			return restarted === null ? "Checkpoint done" : "arbor dev restarted";
		case "restarting":
			return "Restarting arbor dev";
		case "resuming":
			return "Resuming agents";
		case "ended":
			return "Agents resumed";
	}
}

/** A checkpoint whose agents carried on, after `arbor dev` restarted or not. */
interface Ended {
	projects: ProjectChoice[];
	/** The arbor it restarted on; null when it did not restart. */
	restarted: string | null;
}

/** A restart on its way: the run it replaces, and whether the next resumes. */
interface Restarting {
	run: string;
	resume: boolean;
}

/** How long a checkpoint whose agents carried on still says it is done. */
const ENDED = Duration.mins(1);

/** How often the projects are asked for while a checkpoint is under way. */
const EVERY = Duration.secs(1);

/** The projects the dialog offers: those with agents running. */
function offered(projects: ProjectChoice[]): ProjectChoice[] {
	return projects.filter((each) => !each.gone && each.conversations.length > 0);
}

/** How a checkpoint stands, and what opens its dialog. */
interface Checkpointing {
	slide: Slide;
	title: string;
	/** Why the projects could not be listed, for a moment. */
	refusal: string | null;
	/** Opens the dialog, with `after` picked when it offers projects. */
	open: (after?: After) => void;
}

const Checkpointing = createContext<Checkpointing | null>(null);

/** The checkpoint `CheckpointProvider` holds, for a control that opens its dialog. */
export function useCheckpoint(): Checkpointing {
	const found = useContext(Checkpointing);
	if (found === null) {
		throw new Error("useCheckpoint outside a CheckpointProvider");
	}
	return found;
}

/**
 * The page's one checkpoint, and the dialog, opened by ⌥⌘C or `open`, to
 * checkpoint any of the projects with agents running, which says how one
 * under way gets on, then slides on to what to do once it is done, or to
 * `arbor dev` restarting when that was asked for, and from there to what to
 * do after the restart, or to each agent carrying on. Says how it stands to
 * `children`, so the dialog can be closed meanwhile and opened again from
 * them, and still says it is done for a minute after its agents carry on.
 * Asks the server for every project again as `conversations`, this
 * project's, change, and every `every`, a second by default, while a
 * checkpoint or restart is under way or the dialog is open.
 */
export function CheckpointProvider({
	conversations,
	every = EVERY,
	children,
}: {
	conversations: ConversationState[];
	every?: Duration;
	children: ReactNode;
}): JSX.Element {
	const [listed, setListed] = useState<Projects | null>(null);
	const [open, setOpen] = useState(false);
	// What follows the checkpoint, as the dialog was opened to pick.
	const [after, setAfter] = useState<After>("stop");
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
				setAfter("stop");
				setOpen(true);
			}
		};
		document.addEventListener("keydown", press);
		return () => document.removeEventListener("keydown", press);
	}, []);
	// The checkpoint that ended last, while it says so.
	const [ended, setEnded] = useState<Ended | null>(null);
	const [restarting, setRestarting] = useState<Restarting | null>(null);
	// Whether the server stopped answering, as while it restarts.
	const [unreachable, setUnreachable] = useState(false);
	// Those of the checkpoint under way or done, for when it ends.
	const last = useRef<ProjectChoice[]>([]);
	// Closed once done, so its end says nothing, stopped as its agents are.
	const forgotten = useRef(false);
	// Seen telling its agents to carry on after a restart, until each has.
	const resumed = useRef(false);
	// Back from a restart whose agents waited to be resumed, until they are.
	const waited = useRef(false);
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
					: listed?.restarted === "resuming"
						? "resuming"
						: live;
	useEffect(() => {
		if (listed === null) {
			return;
		}
		const shown = offered(listed.projects);
		const live = slideOf(standing(shown.flatMap((each) => each.conversations)));
		if (restarting !== null && listed.run !== restarting.run) {
			setRestarting(null);
			// Carried on before the page saw them told to.
			if (restarting.resume && listed.restarted === null) {
				setEnded({ projects: last.current, restarted: listed.running });
				last.current = [];
			}
			return;
		}
		if (listed.restarting !== null && restarting === null) {
			setRestarting({ run: listed.run, ...listed.restarting });
		}
		if (listed.restarted === "resuming") {
			resumed.current = true;
			if (last.current.length === 0) {
				last.current = shown;
			}
			return;
		}
		if (resumed.current) {
			resumed.current = false;
			setEnded({ projects: last.current, restarted: listed.running });
			last.current = [];
			return;
		}
		if (live !== "pick") {
			last.current = shown;
			waited.current = listed.restarted === "waiting";
			setEnded(null);
		} else {
			if (last.current.length > 0 && !forgotten.current) {
				setEnded({
					projects: last.current,
					restarted: waited.current ? listed.running : null,
				});
			}
			last.current = [];
			forgotten.current = false;
			waited.current = false;
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
		if (
			all.going === 0 &&
			!open &&
			restarting === null &&
			slide !== "resuming"
		) {
			return;
		}
		const tick = new SystemTimer().setInterval(() => void load(), every);
		return () => tick.dispose();
	}, [all.going, open, restarting, slide, load, every]);
	const restarted =
		slide === "ended"
			? (ended?.restarted ?? null)
			: slide === "resuming" ||
					(slide === "done" && listed?.restarted === "waiting")
				? (listed?.running ?? null)
				: null;
	const opened = useCallback((after: After = "stop") => {
		setAfter(after);
		setOpen(true);
	}, []);
	const title = titleOf(slide, restarted);
	const value = useMemo(
		() => ({ slide, title, refusal, open: opened }),
		[slide, title, refusal, opened],
	);
	return (
		<Checkpointing.Provider value={value}>
			{children}
			<CheckpointDialog
				open={open}
				after={after}
				onAfter={setAfter}
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
				onRestart={() =>
					setRestarting(
						listed === null ? null : { run: listed.run, resume: false },
					)
				}
				projects={
					slide === "ended"
						? (ended?.projects ?? [])
						: slide === "resuming" && last.current.length > 0
							? last.current
							: shown
				}
				slide={slide}
				restarting={restarting}
				restarted={restarted}
				newest={listed?.newest ?? null}
				current={listed?.projects ?? []}
				restartable={listed?.restartable ?? false}
				onChange={load}
			/>
		</Checkpointing.Provider>
	);
}

/**
 * The title menu's Checkpoint, opening the dialog as ⌥⌘C does, and saying
 * how the checkpoint stands.
 */
export function CheckpointItem(): JSX.Element {
	const { slide, title, open } = useCheckpoint();
	return (
		<DropdownMenuItem onClick={() => open()}>
			{slide === "going" || slide === "restarting" || slide === "resuming" ? (
				<Loader2Icon className="animate-spin" />
			) : slide === "pick" ? (
				<FlagIcon />
			) : (
				<CheckIcon className="text-success" />
			)}
			{title}
			<DropdownMenuShortcut aria-hidden>⌥⌘C</DropdownMenuShortcut>
		</DropdownMenuItem>
	);
}

/**
 * Why the projects could not be listed for a checkpoint, for a moment, under
 * the title, since the menu that asked has closed.
 */
export function CheckpointRefusal({
	className,
}: {
	className?: string;
}): JSX.Element {
	const { refusal } = useCheckpoint();
	return <Refusal refusal={refusal} className={className} />;
}

/**
 * Picks projects to checkpoint and what follows, this one picked to start
 * with; then lists how each agent asked gets on; then, once all have
 * answered, offers to resume them, restart, or retry those it missed; or
 * says `arbor dev` is restarting when that was asked for, then offers to
 * resume them after it, or shows each carry on; and once they have, says
 * so, while `ended`. Closing it once done leaves the agents stopped and
 * forgets the checkpoint.
 */
function CheckpointDialog({
	open,
	after,
	onAfter,
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
	onChange,
}: {
	open: boolean;
	/** What follows the checkpoint, as picked. */
	after: After;
	onAfter: (after: After) => void;
	onClose: () => void;
	/** Forgets a done checkpoint, whose agents stay stopped. */
	onForget: () => void;
	/** Says `arbor dev` is restarting, once asked to. */
	onRestart: () => void;
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
		slide === "restarting"
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
				{/* Keyed, so each slide comes in on its own. */}
				<div
					key={slide}
					className="grid gap-4 duration-200 animate-in fade-in-0 slide-in-from-right-8"
				>
					{slide === "pick" ? (
						<PickSlide
							projects={projects}
							after={after}
							onAfter={onAfter}
							busy={busy}
							newest={newest}
							restartable={restartable}
							onClose={onClose}
							onAsk={(go) =>
								act(() => checkpointProjects(go, after), "Not checkpointed")
							}
							onRestart={() =>
								act(
									() => restartFromCheckpoint().then(onRestart),
									"Not restarted",
								)
							}
						/>
					) : (
						<>
							<DialogHeader>
								<DialogTitle>{titleOf(slide, restarted)}</DialogTitle>
								<DialogDescription>
									{slide === "going"
										? `Each agent is bringing its ARBOR.md up to date${restarting === null ? "" : restarting.resume ? ", then arbor dev restarts and each resumes" : ", then arbor dev restarts"}.`
										: slide === "restarting"
											? `arbor dev is restarting${on(newest)}${restarting?.resume ? ", then each agent resumes" : ", then you pick what comes next"}.`
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
									{slide === "ended" && (
										<Button variant="outline" onClick={() => location.reload()}>
											Reload page
										</Button>
									)}
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
	standing: Standing,
	then: "stopped" | "waiting to resume",
): string {
	return `${plural(standing.asked.length - standing.missed.length)} checkpointed and ${then}.${missing(standing)}`;
}

/** Those a checkpoint missed, in a sentence after another, if any. */
function missing({ missed }: Standing): string {
	return missed.length === 0
		? ""
		: ` ${missed.length} missed: ${missed.map((each) => each.name).join(", ")}.`;
}

/** `count` agents, in words. */
function plural(count: number): string {
	return `${count} ${count === 1 ? "agent" : "agents"}`;
}

/**
 * The projects to pick, with what follows, and the button that asks; with no
 * agent running, a restart straight away when `arbor dev` can make one.
 */
function PickSlide({
	projects,
	after,
	onAfter,
	busy,
	newest,
	restartable,
	onClose,
	onAsk,
	onRestart,
}: {
	projects: ProjectChoice[];
	after: After;
	onAfter: (after: After) => void;
	busy: boolean;
	/** A newer arbor, which a restart lands on. */
	newest: string | null;
	restartable: boolean;
	onClose: () => void;
	onAsk: (projects: string[]) => Promise<void>;
	onRestart: () => Promise<void>;
}): JSX.Element {
	const [picked, setPicked] = useState<Set<string> | null>(null);
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
									onChange={() => onAfter(each.after)}
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
				{projects.length > 0 ? (
					<Button
						disabled={go.length === 0 || busy}
						onClick={() => void onAsk(go)}
					>
						Proceed
					</Button>
				) : (
					restartable && (
						<Button disabled={busy} onClick={() => void onRestart()}>
							{newest === null ? "Restart" : `Restart on ${newest}`}
						</Button>
					)
				)}
			</DialogFooter>
		</>
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

/** An agent back at work after its checkpoint. */
function CheckpointResumed(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="Resumed"
			title="Resumed"
			className="flex shrink-0 self-center text-success"
		>
			<CheckIcon className="size-3.5" />
		</span>
	);
}

/** An agent told to carry on after its checkpoint, not yet back, as an icon. */
function Resuming(): JSX.Element {
	return (
		<span
			role="img"
			aria-label="Resuming"
			title="Resuming"
			className="flex shrink-0 self-center text-muted-foreground"
		>
			<Loader2Icon className="size-3.5 animate-spin" />
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

const SAYS: Record<Checkpoint, string> = {
	asked: "Checkpointing",
	done: "Checkpointed",
	failed: "Failed",
	unanswered: "No response",
};

/**
 * How far one conversation's checkpoint has got, as an icon, the word in its
 * name and tooltip.
 */
function CheckpointState({
	checkpoint,
}: {
	checkpoint: Checkpoint;
}): JSX.Element {
	return (
		<span
			role="img"
			aria-label={SAYS[checkpoint]}
			title={SAYS[checkpoint]}
			className={cn(
				"flex shrink-0 self-center",
				checkpoint === "done"
					? "text-success"
					: checkpoint === "asked"
						? "text-muted-foreground"
						: "text-destructive",
			)}
		>
			{checkpoint === "asked" ? (
				<Loader2Icon className="size-3.5 animate-spin" />
			) : checkpoint === "done" ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CircleAlertIcon className="size-3.5" />
			)}
		</span>
	);
}
