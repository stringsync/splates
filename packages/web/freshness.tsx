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
 * The inbox's rows, kept but dimmed and `inert` while the page is locked, so
 * nothing is opened or answered on what has moved.
 */
export function StaleRows({ children }: { children: ReactNode }): JSX.Element {
	const { locked } = useFreshness();
	return (
		<div
			inert={locked}
			aria-busy={locked}
			className={cn("contents", locked && "*:opacity-50")}
		>
			{children}
		</div>
	);
}

/**
 * `children`, taking no input while the page is locked, so an answer or an
 * archive is never made on what has moved; `CatchingUp` and `StaleChip` say why.
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
 * Says on a phone that the page may be stale, once it has been a moment:
 * "Updating…" in muted text at the top of the screen, a line sweeping under it.
 * A desktop says it in its bar instead, with `StaleChip` and `StaleLine`.
 * Once the server stays unreachable the page unlocks and this says nothing:
 * the bar's `OfflinePill` does.
 */
export function CatchingUp(): JSX.Element | null {
	const { unreachable, locked } = useFreshness();
	if (!useSaysStale() || unreachable || !locked) {
		return null;
	}
	return (
		<>
			<span
				role="status"
				className="-translate-x-1/2 fade-in-0 fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 z-[60] animate-in whitespace-nowrap rounded-full border bg-background px-2.5 py-0.5 text-muted-foreground text-xs duration-200"
			>
				Updating…
			</span>
			<div
				aria-hidden
				className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/10"
			>
				<div className="h-full w-2/5 animate-sweep bg-primary/60 motion-reduce:hidden" />
			</div>
		</>
	);
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

/**
 * Says in a desktop's bar, beside the title, that the page may be stale:
 * "Updating…", or once the server stays unreachable, that it is offline.
 */
export function StaleChip(): JSX.Element | null {
	const { unreachable } = useFreshness();
	if (!useSaysStale()) {
		return null;
	}
	if (unreachable) {
		return <OfflinePill />;
	}
	return (
		<span
			role="status"
			className="fade-in-0 shrink-0 animate-in whitespace-nowrap text-muted-foreground text-xs duration-200"
		>
			Updating…
		</span>
	);
}

/**
 * The line along the foot of a desktop's bar while the page is locked and says
 * so, sweeping across it. Sticky under the bar, it spans the page and only the
 * page.
 */
export function StaleLine(): JSX.Element | null {
	const { locked } = useFreshness();
	if (!useSaysStale() || !locked) {
		return null;
	}
	return (
		<div aria-hidden className="sticky top-(--top-bar-height) z-30 h-0">
			<div className="-top-0.5 absolute inset-x-0 h-0.5 overflow-hidden bg-primary/10">
				<div className="h-full w-2/5 animate-sweep bg-primary/60 motion-reduce:hidden" />
			</div>
		</div>
	);
}
