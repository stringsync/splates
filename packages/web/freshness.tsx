import { useReactive } from "@webappwiz/react";
import { Loader2Icon, WifiOffIcon, XIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import type { Feed } from "./feed";

/**
 * Whether what the page shows of the project may be stale: drawn from a kept
 * copy, or from before a sleep or a dropped stream, the server not having
 * said since. The page is locked then, so nothing is done on what has since
 * moved, until the server answers or the person dismisses its saying it
 * cannot reach splates.
 */
export interface Freshness {
	stale: boolean;
	/** Stale for as long as the server is given to answer before the page says so. */
	unreachable: boolean;
	/** Stale and not dismissed: the page takes no input. */
	locked: boolean;
	/** Opens the streams again and reads afresh now. */
	retry: () => void;
	/**
	 * Unlocks the page while splates cannot be reached, so what it shows can
	 * still be read and copied; it locks again once stale anew.
	 */
	dismiss: () => void;
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	locked: false,
	retry: () => {},
	dismiss: () => {},
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
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => {
		setWaited(false);
		setDismissed(false);
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
			locked: stale && !(unreachable && dismissed),
			retry: () => {
				feed.retry();
				talk.retry();
			},
			dismiss: () => setDismissed(true),
		}),
		[stale, unreachable, dismissed, feed, talk],
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
 * archive is never made on what has moved; `CatchingUp` says why.
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
 * Says on a phone that the page may be stale, once it has been a moment: it
 * dims the whole screen with "Catching up…" at its centre. Once the server
 * stays unreachable it says so, with Retry and a dismiss that unlocks the
 * page, leaving a pill that still offers Retry. A desktop says it in its bar
 * instead, with `StaleChip` and `StaleLine`.
 */
export function CatchingUp(): JSX.Element | null {
	const { unreachable, locked, retry, dismiss } = useFreshness();
	if (!useSaysStale()) {
		return null;
	}
	const said = (
		<Said
			unreachable={unreachable}
			retry={retry}
			dismiss={locked ? dismiss : null}
			compact={!locked}
		/>
	);
	if (!locked) {
		return (
			<div className="-translate-x-1/2 fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 z-[60]">
				{said}
			</div>
		);
	}
	return (
		<div className="fade-in-0 fixed inset-0 z-[90] grid animate-in place-items-center bg-background/60 duration-200 supports-backdrop-filter:backdrop-blur-[2px]">
			{said}
		</div>
	);
}

/**
 * Says in a desktop's bar, beside the title, that the page may be stale:
 * "Catching up…", or once the server stays unreachable, that it cannot reach
 * splates, with Retry and, while the page is locked, a dismiss that unlocks it.
 */
export function StaleChip(): JSX.Element | null {
	const { unreachable, locked, retry, dismiss } = useFreshness();
	if (!useSaysStale()) {
		return null;
	}
	if (!unreachable) {
		return (
			<span
				role="status"
				className="fade-in-0 flex shrink-0 animate-in items-center gap-1.5 whitespace-nowrap rounded-full border bg-background px-2.5 py-0.5 text-muted-foreground text-xs duration-200"
			>
				<Loader2Icon aria-hidden className="size-3.5 animate-spin" />
				Catching up…
			</span>
		);
	}
	return (
		<span
			role="alert"
			className="fade-in-0 flex shrink-0 animate-in items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 py-0.5 pr-0.5 pl-2.5 text-amber-700 text-xs duration-200 dark:text-amber-300"
		>
			<WifiOffIcon aria-hidden className="size-3.5" />
			Can't reach splates
			<Button
				variant="outline"
				size="xs"
				className="ml-1 h-5 rounded-full"
				onClick={retry}
			>
				Retry
			</Button>
			{locked && (
				<Button
					variant="ghost"
					size="icon-xs"
					className="size-5 rounded-full"
					aria-label="Dismiss"
					title="Dismiss, to use the page as it was"
					onClick={dismiss}
				>
					<XIcon />
				</Button>
			)}
		</span>
	);
}

/**
 * The line along the foot of a desktop's bar while the page is locked and says
 * so: one sweeping across it while catching up, amber once splates cannot be
 * reached. Sticky under the bar, it spans the page and only the page.
 */
export function StaleLine(): JSX.Element | null {
	const { unreachable, locked } = useFreshness();
	if (!useSaysStale() || !locked) {
		return null;
	}
	return (
		<div aria-hidden className="sticky top-(--top-bar-height) z-30 h-0">
			<div
				className={cn(
					"-top-0.5 absolute inset-x-0 h-0.5 overflow-hidden",
					unreachable ? "bg-amber-500/70" : "bg-primary/10",
				)}
			>
				{!unreachable && (
					<div className="h-full w-2/5 animate-sweep bg-primary/60 motion-reduce:hidden" />
				)}
			</div>
		</div>
	);
}

function Said({
	unreachable,
	retry,
	dismiss,
	compact,
}: {
	unreachable: boolean;
	retry: () => void;
	dismiss: (() => void) | null;
	compact: boolean;
}): JSX.Element {
	return (
		<div
			role={unreachable ? "alert" : "status"}
			className={cn(
				"flex items-center whitespace-nowrap rounded-xl border bg-background shadow-lg",
				compact ? "gap-2 py-1 pr-1 pl-3 text-xs" : "gap-3 px-5 py-3 text-sm",
				dismiss !== null && "pr-2",
			)}
		>
			{unreachable ? (
				<>
					<WifiOffIcon aria-hidden className="size-4 text-muted-foreground" />
					Can't reach splates.
					<Button
						variant="outline"
						size={compact ? "xs" : "sm"}
						onClick={retry}
					>
						Retry
					</Button>
					{dismiss !== null && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Dismiss"
							title="Dismiss, to use the page as it was"
							onClick={dismiss}
						>
							<XIcon />
						</Button>
					)}
				</>
			) : (
				<>
					<Loader2Icon
						aria-hidden
						className="size-4 animate-spin text-muted-foreground"
					/>
					Catching up…
				</>
			)}
		</div>
	);
}
