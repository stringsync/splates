import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon, WifiOffIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import { Countdown } from "./countdown";
import type { Feed } from "./feed";
import { SIGN_IN } from "./sign-in";

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
	/** What the last read failed with, while unreachable. */
	reason: string | null;
	/** When a locked page gives up waiting and unlocks, in `Date.now()` ms. */
	givesUpAt: number | null;
	/** How long a locked page waits in all, in ms. */
	waitsMs: number;
	/** Opens the streams again and reads afresh, waiting anew. */
	retry: () => void;
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	locked: false,
	reason: null,
	givesUpAt: null,
	waitsMs: 0,
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
	const [givesUpAt, setGivesUpAt] = useState<number | null>(null);
	// Each retry waits anew.
	const [_tries, setTries] = useState(0);
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			setGivesUpAt(null);
			return;
		}
		setGivesUpAt(Date.now() + feed.offlineAfter.ms);
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
	const locked = stale && !unreachable;
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
			locked,
			reason: snapshot.failure,
			givesUpAt: locked ? givesUpAt : null,
			waitsMs: feed.offlineAfter.ms,
			retry,
		}),
		[stale, unreachable, locked, snapshot.failure, givesUpAt, feed, retry],
	);
}

export const REFRESH_WAITS = {
	/** How long a refresh runs before `RefreshingOverlay` shows its timeout. */
	slow: Duration.secs(10),
	fade: Duration.ms(200),
};

/**
 * Prevents interaction with stale content and shows a short timeout on a second
 * row when a refresh takes too long. Render it once above the app's content.
 */
// It fades in after a moment, so a quick refresh never flashes it.
export function RefreshingOverlay({
	updating = false,
}: {
	updating?: boolean;
}): JSX.Element | null {
	const { locked, givesUpAt, waitsMs } = useFreshness();
	const active = locked || updating;
	const [shown, setShown] = useState(active);
	useEffect(() => {
		if (active) {
			setShown(true);
			return;
		}
		const fading = setTimeout(() => setShown(false), REFRESH_WAITS.fade.ms);
		return () => clearTimeout(fading);
	}, [active]);
	if (!shown) {
		return null;
	}
	return (
		<Refreshing closing={!active} givesUpAt={givesUpAt} waitsMs={waitsMs} />
	);
}

function Refreshing({
	closing,
	givesUpAt,
	waitsMs,
}: {
	closing: boolean;
	givesUpAt: number | null;
	waitsMs: number;
}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (closing) {
			return;
		}
		const others = [...document.body.children].filter(
			(each): each is HTMLElement =>
				each instanceof HTMLElement && each !== ref.current && !each.inert,
		);
		for (const each of others) {
			each.inert = true;
		}
		return () => {
			for (const each of others) {
				each.inert = false;
			}
		};
	}, [closing]);
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		setSlow(false);
		const waiting = setTimeout(() => setSlow(true), REFRESH_WAITS.slow.ms);
		return () => clearTimeout(waiting);
	}, []);
	return createPortal(
		<div
			ref={ref}
			aria-hidden={closing}
			className={cn(
				"fixed inset-0 z-100 flex h-dvh touch-none items-center justify-center bg-background/60 p-4 backdrop-blur-[2px] motion-safe:fill-mode-both motion-safe:duration-200 md:h-auto",
				closing
					? "pointer-events-none motion-safe:animate-out motion-safe:fade-out"
					: "motion-safe:animate-in motion-safe:fade-in motion-safe:delay-300",
			)}
		>
			<div className="flex max-w-sm flex-col gap-2 rounded-xl border bg-popover px-4 py-3 text-center text-popover-foreground shadow-lg">
				<div
					role="status"
					aria-label="Refreshing"
					className="flex items-center justify-center gap-2 text-sm"
				>
					<LoaderCircleIcon
						aria-hidden
						className="size-4 shrink-0 motion-safe:animate-spin"
					/>
					Refreshing…
				</div>
				{slow && (
					<div className="flex items-center justify-center gap-3">
						<Countdown
							givesUpAt={givesUpAt}
							waitsMs={waitsMs}
							format="timeout"
							quiet={false}
						/>
					</div>
				)}
			</div>
		</div>,
		document.body,
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

/** Shows inbox rows without allowing input while the page may be stale. */
export function StaleRows({ children }: { children: ReactNode }): JSX.Element {
	const { locked } = useFreshness();
	return (
		<div inert={locked} aria-busy={locked} className="contents">
			{children}
		</div>
	);
}

/**
 * `children`, taking no input while the page is locked, so an answer or an
 * archive is never made on what has moved.
 */
export function Locked({ children }: { children: ReactNode }): JSX.Element {
	const { locked } = useFreshness();
	return (
		<div inert={locked} aria-busy={locked} className="contents">
			{children}
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
			className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-destructive/30 border-b bg-destructive/10 px-4 py-2.5 text-sm"
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<WifiOffIcon className="size-4 shrink-0 text-destructive" />
				<p>
					<span className="font-medium text-destructive">
						{disconnected ? "Disconnected." : "Offline."}
					</span>{" "}
					<span className="text-muted-foreground">
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
