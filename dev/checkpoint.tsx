import { CheckIcon, FlagIcon, Loader2Icon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Duration, SystemClock, SystemTimer } from "webappwiz/time";
import {
	DropdownMenuItem,
	DropdownMenuShortcut,
} from "#dev/components/ui/dropdown-menu.tsx";
import { useShortcut, useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import type { After, ConversationState } from "../conversations";
import { CheckpointDialog, type Restarting } from "./checkpoint-dialog";
import { type Slide, slideOf, standing, titleOf } from "./checkpoint-slide";
import { listProjects, type ProjectChoice, type Projects } from "./project-api";
import { Refusal, useRefusal } from "./refusal";

/** A checkpoint whose agents carried on, after `arbor dev` restarted or not. */
interface Ended {
	projects: ProjectChoice[];
	/** The arbor it restarted on; null when it did not restart. */
	restarted: string | null;
}

/**
 * The checkpoint `listed` ends, if it ends one, given what was seen before:
 * its agents told to carry on after a restart now have, or it is no longer
 * listed.
 */
function endOf(
	listed: Projects,
	live: Slide,
	was: {
		resumed: RefObject<boolean>;
		last: RefObject<ProjectChoice[]>;
		forgotten: RefObject<boolean>;
		waited: RefObject<boolean>;
	},
): Ended | null {
	return listed.restarted === "resuming"
		? null
		: was.resumed.current
			? { projects: was.last.current, restarted: listed.running }
			: live === "pick" && was.last.current.length > 0 && !was.forgotten.current
				? {
						projects: was.last.current,
						restarted: was.waited.current ? listed.running : null,
					}
				: null;
}

/** How long a checkpoint whose agents carried on still says it is done. */
const ENDED = Duration.mins(1);

/**
 * How long the Restart slide shows at least, so a restart quicker than the
 * page can see is still seen.
 */
const RESTART_SHOWN = Duration.secs(3);

/** How often the projects are asked for while a checkpoint is under way. */
const EVERY = Duration.secs(1);

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
 * The page's one checkpoint, and the dialog, opened by its shortcut or `open`, to
 * checkpoint any of the projects with agents running, which says how one
 * under way gets on, then slides on to what to do once it is done, or to
 * `arbor dev` restarting when that was asked for, and from there to what to
 * do after the restart, or to each agent carrying on. Says how it stands to
 * `children`, so the dialog can be closed meanwhile and opened again from
 * them, and still says it is done while open, and for a minute once closed, after its agents carry on.
 * Asks the server for every project again as `conversations`, this
 * project's, change, and every `every`, a second by default, while a
 * checkpoint or restart is under way or the dialog is open. Holds the
 * Restart slide for `restartShown` at least, three seconds by default, even
 * once `arbor dev` is back.
 */
export function CheckpointProvider({
	conversations,
	every = EVERY,
	restartShown = RESTART_SHOWN,
	children,
}: {
	conversations: ConversationState[];
	every?: Duration;
	restartShown?: Duration;
	children: ReactNode;
}): JSX.Element {
	const [listed, setListed] = useState<Projects | null>(null);
	const [open, setOpen] = useState(false);
	// What follows the checkpoint, as the dialog was opened to pick.
	const [after, setAfter] = useState<After>("stop");
	useShortcut("shortcuts.checkpoint", () => {
		setAfter("stop");
		setOpen(true);
	});
	// The checkpoint that ended last, while it says so.
	const [ended, setEnded] = useState<Ended | null>(null);
	const [restarting, setRestarting] = useState<Restarting | null>(null);
	// The arbor a restart with no agent to resume came back on, while it says
	// so.
	const [back, setBack] = useState<string | null>(null);
	// When the Restart slide first showed, or the restart was seen to be over
	// without it having shown.
	const restartSince = useRef<Duration | null>(null);
	// Bumped once the Restart slide has shown long enough.
	const [shownLong, setShownLong] = useState(0);
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
	// The last listing asked for, and the newest one shown, so one that lands
	// after a newer one cannot take the dialog back.
	const listings = useRef(0);
	const applied = useRef(0);
	const { refusal, refuse } = useRefusal();
	const load = useCallback(() => {
		const ask = ++listings.current;
		return listProjects().then(
			(next) => {
				if (ask < applied.current) {
					return;
				}
				applied.current = ask;
				setListed(next);
				setUnreachable(false);
			},
			(error: unknown) => {
				if (ask < applied.current) {
					return;
				}
				applied.current = ask;
				// The next ask finds it once it is back.
				if (error instanceof TypeError) {
					setUnreachable(true);
				} else {
					refuse("Projects not listed", error);
				}
			},
		);
	}, [refuse]);
	// A change here is the one the page hears of; others come by asking.
	const here = conversations
		.map((each) => `${each.id}:${each.status}:${each.checkpoint}`)
		.join();
	useEffect(() => {
		void here;
		void load();
	}, [here, load]);
	const was = { resumed, last, forgotten, waited };
	const shown = offered(listed?.projects ?? []);
	const all = standing(shown.flatMap((each) => each.conversations));
	const live = slideOf(all);
	// Ended as of this listing, before the effect below says so, so the
	// dialog goes straight to it rather than through the start.
	const ending =
		ended ??
		(listed === null || restarting !== null ? null : endOf(listed, live, was));
	// Gone to restart, its agents have answered, if not as the page last saw.
	const slide: Slide =
		live === "going" && !(restarting !== null && unreachable)
			? "going"
			: ending !== null
				? "ended"
				: restarting !== null
					? "restarting"
					: back !== null
						? "restarted"
						: listed?.restarted === "resuming"
							? "resuming"
							: live;
	useEffect(() => {
		if (listed === null) {
			return;
		}
		const shown = offered(listed.projects);
		const live = slideOf(standing(shown.flatMap((each) => each.conversations)));
		// Asks again once the Restart slide has shown long enough.
		void shownLong;
		if (restarting !== null && listed.run !== restarting.run) {
			const clock = new SystemClock();
			restartSince.current ??= clock.now();
			const left = restartShown.subtract(
				clock.now().subtract(restartSince.current),
			);
			if (left.isGreaterThan(Duration.zero())) {
				const wait = new SystemTimer().setTimeout(
					() => setShownLong((count) => count + 1),
					left,
				);
				return () => wait.dispose();
			}
			restartSince.current = null;
			setRestarting(null);
			// Carried on before the page saw them told to.
			if (restarting.resume && listed.restarted === null) {
				setEnded({ projects: last.current, restarted: listed.running });
				last.current = [];
			} else if (!restarting.resume && live === "pick") {
				setBack(listed.running);
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
		const end = endOf(listed, live, { resumed, last, forgotten, waited });
		if (end !== null) {
			setEnded(end);
		}
		if (resumed.current) {
			resumed.current = false;
			last.current = [];
			return;
		}
		if (live !== "pick") {
			last.current = shown;
			waited.current = listed.restarted === "waiting";
			setEnded(null);
			setBack(null);
		} else {
			last.current = [];
			forgotten.current = false;
			waited.current = false;
		}
	}, [listed, restarting, restartShown, shownLong]);
	// Open, it stays until closed, rather than going back to the start.
	useEffect(() => {
		if (slide === "restarting") {
			restartSince.current ??= new SystemClock().now();
		}
	}, [slide]);
	useEffect(() => {
		if ((ended === null && back === null) || open) {
			return;
		}
		const shown = new SystemTimer().setTimeout(() => {
			setEnded(null);
			setBack(null);
		}, ENDED);
		return () => shown.dispose();
	}, [ended, back, open]);
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
			? (ending?.restarted ?? null)
			: slide === "restarted"
				? back
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
					setBack(null);
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
						? (ending?.projects ?? [])
						: slide === "restarted"
							? []
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
 * The title menu's Checkpoint, opening the dialog as its shortcut does, and saying
 * how the checkpoint stands.
 */
export function CheckpointItem(): JSX.Element {
	const { slide, title, open } = useCheckpoint();
	const shortcut = useShortcutLabel("shortcuts.checkpoint");
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
			{shortcut !== null && (
				<DropdownMenuShortcut aria-hidden>{shortcut}</DropdownMenuShortcut>
			)}
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

/** The projects the dialog offers: those with agents running. */
function offered(projects: ProjectChoice[]): ProjectChoice[] {
	return projects.filter((each) => !each.gone && each.conversations.length > 0);
}
