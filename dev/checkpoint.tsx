import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { CheckIcon, Loader2Icon, PowerIcon } from "lucide-react";
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
import { DropdownMenuItem } from "#dev/components/ui/dropdown-menu.tsx";
import type { ConversationState } from "../conversations";
import type { AutoRestart } from "./auto-restart";
import { CheckpointDialog, type Restarting } from "./checkpoint-dialog";
import {
	plural,
	type Run,
	type Slide,
	slideOf,
	standing,
	titleOf,
} from "./checkpoint-slide";
import { listProjects, type ProjectChoice, type Projects } from "./project-api";
import { Refusal, useRefusal } from "./refusal";
import { ontoOf, UpdateDot } from "./release";

/** How a checkpoint stands, and what opens its dialog. */
interface Checkpointing {
	slide: Slide;
	/** What the header says of a run under way; null for nothing. */
	badge: string | null;
	title: string;
	/** Why the projects could not be listed, for a moment. */
	refusal: string | null;
	/** Opens the dialog. */
	open: () => void;
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
 * Holds the page's one checkpoint and Power's dialog: wrap the page in it,
 * and read it through `useCheckpoint` from the controls that open the dialog
 * or say how a restart stands. Pass this project's `conversations`, so a
 * checkpoint hears of their answers at once, and `autoRestart`, whose
 * countdown it shows; `every`, `restartShown` and `reload` are for tests.
 * After a restart's reload, it opens on how the restart ended and the arbor
 * it now runs.
 */
export function CheckpointProvider({
	conversations,
	every = EVERY,
	restartShown = RESTART_SHOWN,
	reload = () => location.reload(),
	autoRestart,
	children,
}: {
	conversations: ConversationState[];
	every?: Duration;
	restartShown?: Duration;
	/** Reloads the page, once a restart asked to is back. */
	reload?: () => void;
	autoRestart: AutoRestart;
	children: ReactNode;
}): JSX.Element {
	const [listed, setListed] = useState<Projects | null>(null);
	// Back from a restart's reload, the arbor it left ("" when unknown).
	const [returned] = useState(() => sessionStorage.getItem(RESTARTED));
	// Back from a restart's reload, open on how it ended.
	const [open, setOpen] = useState(returned !== null);
	useDisposerEffect(
		(disposer) => disposer.use(autoRestart.start()),
		[autoRestart],
	);
	const { auto } = useReactive(
		autoRestart,
		(autoRestart) => ({ auto: autoRestart.state }),
		["changed"],
	);
	useEffect(() => autoRestart.hold(open), [autoRestart, open]);
	// Back from a restart's reload, until the first listing says how it ended.
	const returning = useRef(returned !== null);
	// The arbor the restart left, for its last slide; null when unknown.
	const [from, setFrom] = useState(returned || null);
	useEffect(() => sessionStorage.removeItem(RESTARTED), []);
	// The arbor this run runs, as the restart it may yet leave on finds it.
	const running = useRef<string | null>(null);
	// Whether a restart or shutdown checkpoints first, as last picked.
	const [checkpoint, setCheckpoint] = useState(true);
	// How to reload the page once a restart is back, as of the last render.
	const reloads = useRef(reload);
	reloads.current = reload;
	// The checkpoint that ended last, while it says so.
	const [ended, setEnded] = useState<Ended | null>(null);
	const [restarting, setRestarting] = useState<Restarting | null>(null);
	// Gone to restart on its own, the restart is Power's to see through.
	useEffect(() => {
		if (auto.step === "restarting") {
			setRestarting({ run: auto.run, resume: false, shutdown: false });
			setOpen(true);
		}
	}, [auto]);
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
	// Seen telling its agents to carry on after a restart, until each has.
	const resumed = useRef(false);
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
	const was = { resumed, last };
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
				: restarting?.shutdown
					? unreachable
						? "shutDown"
						: "shuttingDown"
					: restarting !== null
						? "restarting"
						: back !== null
							? "restarted"
							: listed?.restarted === "resuming"
								? "resuming"
								: live === "pick" && auto.step === "counting"
									? "counting"
									: live;
	useEffect(() => {
		if (listed === null) {
			return;
		}
		const shown = offered(listed.projects);
		const live = slideOf(standing(shown.flatMap((each) => each.conversations)));
		// Asks again once the Restart slide has shown long enough.
		void shownLong;
		if (restarting === null || listed.run === restarting.run) {
			running.current = listed.running;
		}
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
			// Served afresh, so the page runs what the new run built, and
			// opens there on how the restart ended.
			sessionStorage.setItem(RESTARTED, running.current ?? "");
			setFrom(running.current);
			reloads.current();
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
		const end = endOf(listed, live, { resumed, last });
		if (end !== null) {
			setEnded(end);
		}
		// Back after the agents carried on, or with none to: restarted, then.
		if (returning.current) {
			returning.current = false;
			if (end === null && live === "pick") {
				setBack(listed.running);
			}
		}
		if (resumed.current) {
			resumed.current = false;
			last.current = [];
			return;
		}
		if (live !== "pick") {
			last.current = shown;
			setEnded(null);
			setBack(null);
		} else {
			last.current = [];
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
				: slide === "resuming"
					? (listed?.running ?? null)
					: null;
	const opened = useCallback(() => setOpen(true), []);
	const run: Run =
		restarting === null ? null : restarting.shutdown ? "shutdown" : "restart";
	const title = titleOf(slide, run, restarted !== null);
	// Checkpointed and not yet told to carry on.
	const waiting = all.asked.filter((each) => each.checkpoint === "done").length;
	const badge = badgeOf(slide, run, waiting);
	const value = useMemo(
		() => ({ slide, badge, title, refusal, open: opened }),
		[slide, badge, title, refusal, opened],
	);
	return (
		<Checkpointing.Provider value={value}>
			{children}
			<CheckpointDialog
				open={open || slide === "counting"}
				checkpoint={checkpoint}
				onCheckpoint={setCheckpoint}
				onClose={() => {
					setOpen(false);
					if (slide === "counting") {
						autoRestart.cancel();
					}
					// Seen, so the button is free for the next one.
					if (slide === "ended") {
						setEnded(null);
					}
					setBack(null);
					setFrom(null);
				}}
				onRestart={(shutdown = false) =>
					setRestarting(
						listed === null
							? null
							: { run: listed.run, resume: false, shutdown },
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
				run={run}
				title={title}
				restarted={restarted}
				from={from}
				onto={listed === null ? null : ontoOf(listed)}
				current={listed?.projects ?? []}
				restartable={listed?.restartable ?? false}
				held={listed?.held ?? []}
				countdown={
					auto.step === "counting" ? { left: auto.left, onto: auto.onto } : null
				}
				onCancel={() => autoRestart.cancel()}
				onRestartNow={() => void autoRestart.restartNow()}
				onChange={load}
			/>
		</Checkpointing.Provider>
	);
}

/**
 * The title menu's Power, opening the dialog, saying
 * how the checkpoint stands, and dotted, titled with `update`, when a
 * restart would update.
 */
export function CheckpointItem({
	update,
}: {
	update: string | null;
}): JSX.Element {
	const { slide, title, open } = useCheckpoint();
	const restartToUpdate = slide === "pick" && update !== null;
	return (
		<DropdownMenuItem
			title={update ?? undefined}
			aria-label={restartToUpdate ? "Power: restart to update" : undefined}
			onClick={() => open()}
		>
			{slide === "going" ||
			slide === "restarting" ||
			slide === "resuming" ||
			slide === "shuttingDown" ? (
				<Loader2Icon className="animate-spin" />
			) : slide === "pick" || slide === "counting" ? (
				<span className="relative flex">
					<PowerIcon />
					{update !== null && <UpdateDot ring="ring-popover" />}
				</span>
			) : (
				<CheckIcon className="text-success" />
			)}
			{title}
		</DropdownMenuItem>
	);
}

/**
 * The header's word on a restart under way, as plain text in the path's
 * place, opening Power; nothing otherwise.
 */
export function PowerBadge(): JSX.Element | null {
	const { badge, open } = useCheckpoint();
	if (badge === null) {
		return null;
	}
	return (
		<button
			type="button"
			title="Open Power"
			onClick={() => open()}
			className="flex min-w-0 items-center gap-1.5 self-start text-muted-foreground text-xs hover:underline"
		>
			<Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin" />
			<span className="truncate">{badge}</span>
		</button>
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
	},
): Ended | null {
	return listed.restarted === "resuming"
		? null
		: was.resumed.current
			? { projects: was.last.current, restarted: listed.running }
			: live === "pick" && was.last.current.length > 0
				? { projects: was.last.current, restarted: null }
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

/**
 * Where a restart's reload leaves word that it restarted, and the arbor it
 * left, for the tab alone.
 */
const RESTARTED = "arbor.power.restarted";

/**
 * The header's word on the run `slide` is under way in, so it shows whether or
 * not Power is open, with its agents `waiting` being resumed; null once done,
 * which Power's last slide says instead.
 */
function badgeOf(slide: Slide, run: Run, waiting: number): string | null {
	if ((slide === "going" && run === "restart") || slide === "restarting") {
		return "Restarting";
	}
	if ((slide === "going" && run === "shutdown") || slide === "shuttingDown") {
		return "Shutting down";
	}
	if (slide === "resuming") {
		return `Resuming ${plural(waiting)}`;
	}
	return null;
}
