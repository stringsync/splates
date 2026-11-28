import { useReactive } from "core/react";
import { Duration } from "core/time";
import { WifiOffIcon } from "lucide-react";
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
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import type { Feed } from "./feed";
import { LoadingState, Spinner } from "./pending";
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

/** Quiet header feedback, with details on tap without blocking the page. */
export function RefreshStatus({
	updating = false,
	description,
	className,
}: {
	updating?: boolean;
	description?: string;
	className?: string;
}): JSX.Element | null {
	const { stale, unreachable } = useFreshness();
	if (!updating && (!stale || unreachable)) {
		return null;
	}
	const title = updating ? "Updating the server…" : "Refreshing…";
	return (
		<Popover>
			<PopoverTrigger
				render={<Button variant="ghost" size="icon" />}
				aria-label={updating ? "Updating" : "Refreshing"}
				aria-busy={updating}
				title="Show progress"
				className={cn("shrink-0", className)}
			>
				<span
					role="status"
					aria-label="Refreshing"
					className="flex text-muted-foreground"
				>
					<Spinner aria-hidden />
					<span className="sr-only">{title}</span>
				</span>
			</PopoverTrigger>
			<PopoverContent align="end">
				<PopoverTitle>{title}</PopoverTitle>
				<PopoverDescription>
					{description ??
						(updating
							? "Waiting for the updated server to reconnect. This page will reload when it is ready."
							: "Reconnecting to the server and fetching the latest conversations and tasks. You can keep working while the page catches up.")}
				</PopoverDescription>
			</PopoverContent>
		</Popover>
	);
}

/** Widths of each placeholder row's name, project and preview, in rems. */
/**
 * Shows a spinner until the first listing arrives.
 * Pass `className` to fit the inbox layout.
 */
export function InboxLoading({
	className,
}: {
	className?: string;
}): JSX.Element {
	return <LoadingState label="Loading inbox" className={className} />;
}

/**
 * Shows a spinner until conversations have loaded.
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
			className={cn(
				"flex min-w-0 items-center gap-2 px-3 py-1.5 text-left text-muted-foreground text-xs",
				className,
			)}
		>
			<Spinner className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate">Loading conversations…</span>
		</div>
	);
}

/**
 * Shows below the bar that the server cannot be reached and what is shown may
 * be out of date, with Retry to try now rather than on the page's next try.
 */
export function OfflineBanner({
	reason = null,
	disconnected: disconnectedOverride,
}: {
	reason?: string | null;
	disconnected?: boolean;
}): JSX.Element {
	const { retry } = useFreshness();
	const browserDisconnected = useDisconnected();
	const disconnected = disconnectedOverride ?? browserDisconnected;
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
				{retrying && <Spinner aria-hidden />}
				{retrying ? "Retrying…" : "Retry"}
			</Button>
		</div>
	);
}

/** How long Retry says it is retrying, about as long as a try takes to fail. */
const RETRYING = Duration.secs(3);
