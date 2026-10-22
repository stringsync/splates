import { useReactive } from "@webappwiz/react";
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
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	locked: false,
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
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), feed.offlineAfter.ms);
		return () => clearTimeout(waiting);
	}, [stale, feed]);
	const unreachable = stale && (waited || snapshot.offline);
	return useMemo(
		() => ({
			stale,
			unreachable,
			locked: stale && !unreachable,
		}),
		[stale, unreachable],
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
						<Skeleton className="size-10 shrink-0 rounded-full motion-reduce:animate-none" />
						<span className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="flex items-center gap-2">
								<Skeleton
									className={cn(
										"h-4 max-w-[60%] flex-1 motion-reduce:animate-none",
										row.name,
									)}
								/>
								<Skeleton
									className={cn(
										"ml-auto h-3 shrink-0 motion-reduce:animate-none",
										row.project,
									)}
								/>
								<Skeleton className="h-3 w-8 shrink-0 motion-reduce:animate-none" />
							</span>
							<Skeleton
								className={cn(
									"h-3.5 max-w-[85%] motion-reduce:animate-none",
									row.preview,
								)}
							/>
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
 * Dimming a little is all it says, with no spinner, line or words, so coming
 * back to the tab after a while is quiet; once the server stays unreachable the page unlocks,
 * undimmed, and `OfflinePill` says so instead.
 */
export function useDimmed(): boolean {
	const { locked } = useFreshness();
	return useSaysStale() && locked;
}

/** The pill that says splates cannot be reached: neutral, with no action. */
export function OfflinePill(): JSX.Element {
	return (
		<span
			role="status"
			title="splates server stopped answering: is it still running?"
			className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-[11px] text-muted-foreground leading-none"
		>
			<span className="size-1.5 rounded-full bg-muted-foreground/60" />
			Offline
		</span>
	);
}

/** Says in a desktop's bar, beside the title, once the server stays unreachable. */
export function StaleChip(): JSX.Element | null {
	const { unreachable } = useFreshness();
	return unreachable ? <OfflinePill /> : null;
}
