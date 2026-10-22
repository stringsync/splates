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
import { Button } from "#web/components/ui/button.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import type { Feed } from "./feed";

/**
 * Whether what the page shows of the project may be stale: drawn from a kept
 * copy, or from before a sleep or a dropped stream, the server not having
 * said since. The inbox shows none of it then, and the open thread takes no
 * action, so nothing is done on what has since moved.
 */
export interface Freshness {
	stale: boolean;
	/** Stale for as long as the server is given to answer before the page says so. */
	unreachable: boolean;
	/** Opens the streams again and reads afresh now. */
	retry: () => void;
}

const FRESH: Freshness = { stale: false, unreachable: false, retry: () => {} };

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
	return useMemo(
		() => ({
			stale,
			unreachable: stale && (waited || snapshot.offline),
			retry: () => {
				feed.retry();
				talk.retry();
			},
		}),
		[stale, waited, snapshot.offline, feed, talk],
	);
}

/** What the inbox shows in place of its rows while they may be stale. */
export function InboxLoading({
	className,
}: {
	className?: string;
}): JSX.Element {
	const { unreachable, retry } = useFreshness();
	return unreachable ? (
		<div
			role="alert"
			className={cn(
				"flex flex-col items-start gap-2 p-6 text-muted-foreground text-sm",
				className,
			)}
		>
			Can't reach splates.
			<Button variant="outline" size="sm" onClick={retry}>
				Retry
			</Button>
		</div>
	) : (
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
 * The inbox's rows, kept but dimmed and `inert` while they may be stale, so
 * nothing is opened or answered on what has moved; once the server has
 * stayed unreachable it says so above them, with a Retry.
 */
export function StaleRows({ children }: { children: ReactNode }): JSX.Element {
	const { stale, unreachable, retry } = useFreshness();
	return (
		<>
			{stale && unreachable && (
				<div
					role="alert"
					className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-sm"
				>
					Can't reach splates.
					<Button variant="outline" size="sm" onClick={retry}>
						Retry
					</Button>
				</div>
			)}
			<div
				inert={stale}
				aria-busy={stale}
				className={cn("contents", stale && "*:opacity-50")}
			>
				{children}
			</div>
		</>
	);
}

/**
 * `children`, taking no input while the page may be stale, under a line
 * saying so, so an answer or an archive is never made on what has moved.
 */
export function Locked({ children }: { children: ReactNode }): JSX.Element {
	const { stale, unreachable, retry } = useFreshness();
	return (
		<>
			{stale && (
				<div
					role={unreachable ? "alert" : "status"}
					className="-translate-x-1/2 fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 z-50 flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-muted-foreground text-xs shadow-sm"
				>
					{unreachable ? (
						<>
							Can't reach splates.
							<Button variant="ghost" size="xs" onClick={retry}>
								Retry
							</Button>
						</>
					) : (
						"Catching up…"
					)}
				</div>
			)}
			<div inert={stale} aria-busy={stale} className="contents">
				{children}
			</div>
		</>
	);
}
