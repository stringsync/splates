import { useReactive } from "@webappwiz/react";
import { Loader2Icon, WifiOffIcon } from "lucide-react";
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
 * said since. The page is dimmed and takes no action then, so nothing is
 * done on what has since moved.
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
 * The inbox's rows, kept but dimmed and `inert` while they may be stale, so
 * nothing is opened or answered on what has moved.
 */
export function StaleRows({ children }: { children: ReactNode }): JSX.Element {
	const { stale } = useFreshness();
	return (
		<div
			inert={stale}
			aria-busy={stale}
			className={cn("contents", stale && "*:opacity-50")}
		>
			{children}
		</div>
	);
}

/**
 * `children`, taking no input while the page may be stale, so an answer or
 * an archive is never made on what has moved; `CatchingUp` says why.
 */
export function Locked({ children }: { children: ReactNode }): JSX.Element {
	const { stale } = useFreshness();
	return (
		<div inert={stale} aria-busy={stale} className="contents">
			{children}
		</div>
	);
}

// How long the page may be stale before it is dimmed, so a wake the server
// answers at once never flashes the overlay.
const DIM_AFTER_MS = 300;

/**
 * Dims the whole page and takes its clicks while it may be stale, with
 * "Catching up…" at its centre, and once the server stays unreachable says
 * so there, with a Retry.
 */
export function CatchingUp(): JSX.Element | null {
	const { stale, unreachable, retry } = useFreshness();
	const [waited, setWaited] = useState(false);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), DIM_AFTER_MS);
		return () => clearTimeout(waiting);
	}, [stale]);
	if (!stale || !(waited || unreachable)) {
		return null;
	}
	return (
		<div className="fade-in-0 fixed inset-0 z-[90] grid animate-in place-items-center bg-background/60 duration-200 supports-backdrop-filter:backdrop-blur-[2px]">
			<div
				role={unreachable ? "alert" : "status"}
				className="flex items-center gap-3 rounded-xl border bg-background px-5 py-3 text-sm shadow-lg"
			>
				{unreachable ? (
					<>
						<WifiOffIcon aria-hidden className="size-4 text-muted-foreground" />
						Can't reach splates.
						<Button variant="outline" size="sm" onClick={retry}>
							Retry
						</Button>
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
		</div>
	);
}
