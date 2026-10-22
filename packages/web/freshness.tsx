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

/** What the inbox shows in place of its rows before its first read. */
export function InboxLoading({
	className,
}: {
	className?: string;
}): JSX.Element {
	return (
		<div
			role="status"
			aria-label="Loading inbox"
			className={cn("flex flex-col gap-3 p-6", className)}
		>
			<span className="sr-only">Loading inbox…</span>
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
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
 * Says the page may be stale once it has been a moment. On a phone it dims
 * the whole screen with "Catching up…" at its centre; on a desktop it greys
 * the page below the bar, leaving the sidebar, with a toast at the foot.
 * Once the server stays unreachable it says so, with Retry and a dismiss
 * that unlocks the page, leaving a pill that still offers Retry.
 */
export function CatchingUp({ wide }: { wide: boolean }): JSX.Element | null {
	const { stale, unreachable, locked, retry, dismiss } = useFreshness();
	const [waited, setWaited] = useState(false);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), SAY_AFTER_MS);
		return () => clearTimeout(waiting);
	}, [stale]);
	if (!stale || !(waited || unreachable)) {
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
			<div
				className={cn(
					"-translate-x-1/2 fixed left-1/2 z-[60]",
					wide ? "bottom-6" : "top-[calc(env(safe-area-inset-top)+0.5rem)]",
				)}
			>
				{said}
			</div>
		);
	}
	if (wide) {
		return (
			<>
				<div className="fade-in-0 fixed inset-x-0 top-(--top-bar-height) bottom-0 z-[35] animate-in bg-background/50 duration-200" />
				<div className="fade-in-0 slide-in-from-bottom-2 -translate-x-1/2 fixed bottom-6 left-1/2 z-[60] animate-in duration-200">
					{said}
				</div>
			</>
		);
	}
	return (
		<div className="fade-in-0 fixed inset-0 z-[90] grid animate-in place-items-center bg-background/60 duration-200 supports-backdrop-filter:backdrop-blur-[2px]">
			{said}
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
