import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon, WifiOffIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import type { Feed } from "./feed";
import { SIGN_IN } from "./sign-in";

/** Whether the page is catching up with the server, without blocking input. */
export interface Freshness {
	stale: boolean;
	/** Stale for as long as the server is given to answer before the page says so. */
	unreachable: boolean;
	/** What the last read failed with, while unreachable. */
	reason: string | null;
	/** Opens the streams again and reads afresh, waiting anew. */
	retry: () => void;
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	reason: null,
	retry: () => {},
};

/** Fresh unless given, so a part drawn without the page works as it is. */
export const FreshnessContext = createContext<Freshness>(FRESH);

export function useFreshness(): Freshness {
	return useContext(FreshnessContext);
}

/** Browser connectivity changes apply immediately, even while reads are in flight. */
function useDisconnected(): boolean {
	return useSyncExternalStore(listenConnectivity, disconnected, () => false);
}

function disconnected(): boolean {
	return globalThis.navigator?.onLine === false;
}

function listenConnectivity(changed: () => void): () => void {
	window.addEventListener("online", changed);
	window.addEventListener("offline", changed);
	return () => {
		window.removeEventListener("online", changed);
		window.removeEventListener("offline", changed);
	};
}

/** How fresh `feed` and `talk` are, together, for `FreshnessContext`. */
export function useFeedsFreshness(
	feed: Feed,
	talk: ConversationFeed,
): Freshness {
	const disconnected = useDisconnected();
	const snapshot = useReactive(
		feed,
		(feed) => ({
			fresh: feed.fresh,
			offline: feed.offline,
			failure: feed.failure,
		}),
		["changed"],
	);
	const listing = useReactive(talk, (talk) => ({ fresh: talk.fresh }), [
		"changed",
	]);
	const stale = disconnected || !snapshot.fresh || !listing.fresh;
	// Counted here as well as by `feed`, which counts only its own failures.
	const [waited, setWaited] = useState(false);
	// Each retry waits anew.
	const [_tries, setTries] = useState(0);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), feed.offlineAfter.ms);
		return () => clearTimeout(waiting);
	}, [stale, feed]);
	const retry = useCallback(() => {
		if (disconnected) {
			return;
		}
		feed.retry();
		talk.retry();
		setTries((tries) => tries + 1);
	}, [feed, talk, disconnected]);
	const unreachable = stale && (disconnected || waited || snapshot.offline);
	// Behind Cloudflare Access a lapsed sign-in looks like a server that is
	// down, for as long as the page stays open: go and sign in again.
	useEffect(() => {
		if (!unreachable || disconnected) {
			return;
		}
		void SIGN_IN.reloadIfWanted();
	}, [unreachable, disconnected]);
	return useMemo(
		() => ({
			stale,
			unreachable,
			reason: snapshot.failure,
			retry,
		}),
		[stale, unreachable, snapshot.failure, retry],
	);
}

/** Quiet feedback in the header; refreshes never take focus or block input. */
export function RefreshStatus({
	updating = false,
	className,
}: {
	updating?: boolean;
	className?: string;
}): JSX.Element | null {
	const { stale, unreachable } = useFreshness();
	if (!updating && (!stale || unreachable)) {
		return null;
	}
	return (
		<span
			role="status"
			aria-label="Refreshing"
			title={updating ? "Updating the server…" : "Refreshing…"}
			className={cn(
				"flex shrink-0 items-center text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:delay-300 motion-safe:fill-mode-both",
				className,
			)}
		>
			<LoaderCircleIcon
				aria-hidden
				className="size-4 motion-safe:animate-spin"
			/>
			<span className="sr-only">
				{updating ? "Updating the server…" : "Refreshing…"}
			</span>
		</span>
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
 * Shows placeholder inbox rows until the first listing arrives.
 * Pass `className` to fit the inbox layout.
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

/** Widths of each placeholder row's name, in rems. */
const LIST_ROWS = ["w-28", "w-20", "w-32", "w-24"];

/**
 * Shows placeholder sidebar rows until conversations have loaded.
 * Pass `className` to fit the sidebar layout.
 */
export function ListLoading({
	className,
}: {
	className?: string;
}): JSX.Element {
	return (
		<div
			role="status"
			aria-label="Loading conversations"
			className={cn("flex flex-col", className)}
		>
			<span className="sr-only">Loading conversations…</span>
			<ul aria-hidden className="flex flex-col">
				{LIST_ROWS.map((name, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed, never reordered
						key={index}
						className="flex items-center gap-2 py-1.5 pr-2 pl-3"
					>
						<Skeleton className="size-3.5 shrink-0 rounded-full" />
						<Skeleton className={cn("h-3.5", name)} />
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * Shows below the bar that the server cannot be reached and what is shown may
 * be out of date, with Retry to try now rather than on the page's next try.
 */
export function OfflineBanner({
	reason = null,
}: {
	reason?: string | null;
}): JSX.Element {
	const { retry } = useFreshness();
	const disconnected = useDisconnected();
	const [retrying, setRetrying] = useState(false);
	useEffect(() => {
		if (!retrying) {
			return;
		}
		const shown = setTimeout(() => setRetrying(false), RETRYING.ms);
		return () => clearTimeout(shown);
	}, [retrying]);
	return (
		<div
			role="alert"
			title={reason ?? undefined}
			className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted px-4 py-2 text-muted-foreground text-sm"
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<WifiOffIcon className="size-4 shrink-0" />
				<p className="truncate">
					<span className="font-medium">
						{disconnected ? "Disconnected." : "Offline."}
					</span>{" "}
					<span className="hidden sm:inline">
						{disconnected
							? "No internet connection."
							: "The server isn’t responding."}{" "}
						What you see may be out of date.
					</span>
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0"
				disabled={retrying || disconnected}
				onClick={() => {
					setRetrying(true);
					retry();
				}}
			>
				{retrying && (
					<LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
				)}
				{retrying ? "Retrying…" : "Retry"}
			</Button>
		</div>
	);
}

/** How long Retry says it is retrying, about as long as a try takes to fail. */
const RETRYING = Duration.secs(3);
