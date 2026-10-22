import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import type { Feed } from "./feed";

/**
 * Whether what the page shows of the project may be stale: drawn from a kept
 * copy, or from before a sleep or a dropped stream, the server not having
 * said since. The page is locked then, so nothing is done on what has since
 * moved, until the server answers or stays unreachable, when it unlocks so what
 * it shows can be read and copied.
 */
export interface Freshness {
	stale: boolean;
	/** Stale for as long as the server is given to answer before the page says so. */
	unreachable: boolean;
	/** Stale and reachable: the page takes no input. */
	locked: boolean;
	/** While locked, when the page stops waiting and unlocks, in `Date.now()` ms. */
	givesUpAt: number | null;
	/** How long the page waits in all, from going stale to giving up, in ms. */
	waitsMs: number;
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	locked: false,
	givesUpAt: null,
	waitsMs: 0,
};

/** Fresh unless given, so a part drawn without the page works as it is. */
export const FreshnessContext = createContext<Freshness>(FRESH);

export function useFreshness(): Freshness {
	return useContext(FreshnessContext);
}

/** How fresh `feed` and `talk` are, together, for `FreshnessContext`. */
export function useFeedsFreshness(
	feed: Feed,
	talk: ConversationFeed,
): Freshness {
	const snapshot = useReactive(
		feed,
		(feed) => ({ fresh: feed.fresh, offline: feed.offline }),
		["changed"],
	);
	const listing = useReactive(talk, (talk) => ({ fresh: talk.fresh }), [
		"changed",
	]);
	const stale = !snapshot.fresh || !listing.fresh;
	// Counted here as well as by `feed`, which counts only its own failures.
	const [waited, setWaited] = useState(false);
	const [since, setSince] = useState<number | null>(null);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			setSince(null);
			return;
		}
		setSince(Date.now());
		const waiting = setTimeout(() => setWaited(true), feed.offlineAfter.ms);
		return () => clearTimeout(waiting);
	}, [stale, feed]);
	const unreachable = stale && (waited || snapshot.offline);
	const locked = stale && !unreachable;
	const waitsMs = feed.offlineAfter.ms;
	return useMemo(
		() => ({
			stale,
			unreachable,
			locked,
			givesUpAt: locked && since !== null ? since + waitsMs : null,
			waitsMs,
		}),
		[stale, unreachable, locked, since, waitsMs],
	);
}

/** Widths of each placeholder row's name, project and preview, in rems. */
const INBOX_ROWS = [
	{ name: "w-44", project: "w-14", preview: "w-64" },
	{ name: "w-32", project: "w-16", preview: "w-52" },
	{ name: "w-52", project: "w-12", preview: "w-60" },
	{ name: "w-36", project: "w-14", preview: "w-44" },
];

/**
 * What the inbox shows in place of its rows before its first read: rows shaped
 * like the real ones, an avatar, a name with its project and age, and a line
 * of preview, so they hold the same height and nothing jumps when they load.
 */
export function InboxLoading({
	className,
}: {
	className?: string;
}): JSX.Element {
	return (
		<div
			role="status"
			aria-label="Loading inbox"
			className={cn("flex flex-col", className)}
		>
			<span className="sr-only">Loading inbox…</span>
			<ul aria-hidden className="flex flex-col">
				{INBOX_ROWS.map((row, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed, never reordered
						key={index}
						className="flex min-h-16 items-center gap-3 py-2.5 pr-4 pl-4"
					>
						<Skeleton className="size-10 shrink-0 rounded-full" />
						<span className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="flex items-center gap-2">
								<Skeleton className={cn("h-4 max-w-[60%] flex-1", row.name)} />
								<Skeleton className={cn("ml-auto h-3 shrink-0", row.project)} />
								<Skeleton className="h-3 w-8 shrink-0" />
							</span>
							<Skeleton className={cn("h-3.5 max-w-[85%]", row.preview)} />
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The inbox's rows, kept but `inert` while the page is locked, so nothing is
 * opened or answered on what has moved, and dimmed once it has been a moment.
 */
export function StaleRows({ children }: { children: ReactNode }): JSX.Element {
	const { locked } = useFreshness();
	const dimmed = useDimmed();
	return (
		<div
			inert={locked}
			aria-busy={locked}
			// Each row dims, the `contents` box taking no opacity of its own.
			className={cn(
				"contents *:transition-opacity *:duration-300",
				dimmed && "*:opacity-60",
			)}
		>
			{children}
		</div>
	);
}

/**
 * `children`, taking no input while the page is locked, so an answer or an
 * archive is never made on what has moved; the page dims around it to say why.
 */
export function Locked({ children }: { children: ReactNode }): JSX.Element {
	const { locked } = useFreshness();
	return (
		<div inert={locked} aria-busy={locked} className="contents">
			{children}
		</div>
	);
}

// How long the page may be stale before it says so, so a wake the server
// answers at once never flashes it.
const SAY_AFTER_MS = 300;

/**
 * Whether the page says it may be stale: once it has been stale a moment, or
 * at once when the server cannot be reached.
 */
export function useSaysStale(): boolean {
	const { stale, unreachable } = useFreshness();
	const [waited, setWaited] = useState(false);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), SAY_AFTER_MS);
		return () => clearTimeout(waiting);
	}, [stale]);
	return stale && (waited || unreachable);
}

/**
 * Whether what the page shows dims: locked, and stale long enough to say so.
 * Dimming a little is all it says at first, so coming back to the tab after a
 * while is quiet; a wait that runs on gets `GivingUp`'s countdown, and once
 * the server stays unreachable the page unlocks, undimmed, and `OfflinePill`
 * says so instead.
 */
export function useDimmed(): boolean {
	const { locked } = useFreshness();
	return useSaysStale() && locked;
}

// The share of the wait that passes quietly, dimmed, before the countdown shows.
const QUIET_SHARE = 1 / 3;

/**
 * The page's one spinner, once a wait has run on: how long until the page
 * stops waiting on the server, unlocks and says it cannot reach it, so a wait
 * never locks the page for good.
 */
export function GivingUp({
	className,
}: {
	className?: string;
}): JSX.Element | null {
	const { givesUpAt, waitsMs } = useFreshness();
	const now = useTicking(givesUpAt !== null);
	if (givesUpAt === null || givesUpAt - now > waitsMs * (1 - QUIET_SHARE)) {
		return null;
	}
	const seconds = Math.max(1, Math.ceil((givesUpAt - now) / 1000));
	return (
		<span
			role="status"
			className={cn(
				"fade-in-0 flex shrink-0 animate-in items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs duration-300",
				className,
			)}
		>
			<LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
			Still loading, gives up in {seconds}s
		</span>
	);
}

/** `Date.now()`, read again every quarter second while `ticking`. */
function useTicking(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) {
			return;
		}
		setNow(Date.now());
		const ticks = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(ticks);
	}, [ticking]);
	return now;
}

/**
 * Where a phone shows `GivingUp`, having no bar of its own on every screen:
 * a small pill at the top of the screen, only while it counts down.
 */
export function GivingUpPill(): JSX.Element | null {
	return (
		<GivingUp className="-translate-x-1/2 fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 z-[60] rounded-full border bg-background px-2.5 py-0.5" />
	);
}

/**
 * The error the page shows once it gave up waiting: the server cannot be
 * reached. The page is unlocked by then, so what it shows can be read and
 * copied; the streams reopen by themselves, so it offers no Retry.
 */
export function OfflinePill(): JSX.Element {
	return (
		<span
			role="alert"
			title="splates server stopped answering: is it still running? The page keeps trying."
			className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-destructive/40 px-2 py-0.5 font-medium text-[11px] text-destructive leading-none"
		>
			<span className="size-1.5 rounded-full bg-destructive" />
			Can't reach the server
		</span>
	);
}

/**
 * Says in a desktop's bar, beside the title, how long a wait that runs on has
 * left, then once the server stays unreachable, that it cannot be reached.
 */
export function StaleChip(): JSX.Element | null {
	const { unreachable } = useFreshness();
	return unreachable ? <OfflinePill /> : <GivingUp />;
}
