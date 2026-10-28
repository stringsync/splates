import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon } from "lucide-react";
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
import { STATUS_PILL } from "./status-pill";

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

/** How fresh `feed` and `talk` are, together, for `FreshnessContext`. */
export function useFeedsFreshness(
	feed: Feed,
	talk: ConversationFeed,
): Freshness {
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
	const stale = !snapshot.fresh || !listing.fresh;
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
		feed.retry();
		talk.retry();
		setTries((tries) => tries + 1);
	}, [feed, talk]);
	const unreachable = stale && (waited || snapshot.offline);
	const locked = stale && !unreachable;
	// Behind Cloudflare Access a lapsed sign-in looks like a server that is
	// down, for as long as the page stays open: go and sign in again.
	useEffect(() => {
		if (!unreachable) {
			return;
		}
		void SIGN_IN.reloadIfWanted();
	}, [unreachable]);
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

/** How long a refresh runs before `RefreshingOverlay` offers Retry. */
export const REFRESH_WAITS = { slow: Duration.secs(4) };

/**
 * Put once in the page: while the page is locked or an update is under way, it
 * covers the page and makes the rest of it inert. Once a stale-page refresh runs
 * on, a second row counts down to giving up and offers Retry.
 */
// It fades in after a moment, so a quick refresh never flashes it.
export function RefreshingOverlay({
	updating = false,
}: {
	updating?: boolean;
}): JSX.Element | null {
	const { locked, givesUpAt, waitsMs, retry } = useFreshness();
	if (!locked && !updating) {
		return null;
	}
	return (
		<Refreshing
			givesUpAt={givesUpAt}
			waitsMs={waitsMs}
			onRetry={locked ? retry : undefined}
		/>
	);
}

function Refreshing({
	givesUpAt,
	waitsMs,
	onRetry,
}: {
	givesUpAt: number | null;
	waitsMs: number;
	onRetry?: () => void;
}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
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
	}, []);
	const [slow, setSlow] = useState(false);
	// A retry waits anew, so Retry goes until this one runs on too.
	useEffect(() => {
		setSlow(false);
		const waiting = setTimeout(() => setSlow(true), REFRESH_WAITS.slow.ms);
		return () => clearTimeout(waiting);
	}, []);
	return createPortal(
		<div
			ref={ref}
			className="fixed inset-0 z-100 flex touch-none items-center justify-center bg-background/60 p-4 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:delay-300 motion-safe:duration-200"
		>
			<div className="flex max-w-sm flex-col gap-2 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
				<div
					role="status"
					aria-label="Refreshing"
					className="flex items-center gap-2 text-sm"
				>
					<LoaderCircleIcon
						aria-hidden
						className="size-4 shrink-0 motion-safe:animate-spin"
					/>
					Refreshing…
				</div>
				{slow && onRetry !== undefined && (
					<div className="flex items-center gap-3">
						<Countdown
							givesUpAt={givesUpAt}
							waitsMs={waitsMs}
							doing="refreshing"
						/>
						<Button
							variant="outline"
							size="sm"
							className="ml-auto"
							onClick={onRetry}
						>
							Retry
						</Button>
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

/**
 * The inbox's rows, kept but `inert` while the page is locked, so nothing is
 * opened or answered on what has moved.
 */
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
 * Shows that the server cannot be reached, with Retry beside it to try now
 * rather than on the page's own next try. Pass `reason` to include the last
 * read failure beside the label and in its tooltip.
 */
export function OfflinePill({
	reason = null,
}: {
	reason?: string | null;
}): JSX.Element {
	const { retry } = useFreshness();
	const [retrying, setRetrying] = useState(false);
	useEffect(() => {
		if (!retrying) {
			return;
		}
		const shown = setTimeout(() => setRetrying(false), RETRYING.ms);
		return () => clearTimeout(shown);
	}, [retrying]);
	return (
		<span className="flex min-w-0 items-center gap-1">
			<span
				role="alert"
				title={`splates server stopped answering: is it still running? The page keeps trying.${reason === null ? "" : ` Last read: ${reason}`}`}
				className={`${STATUS_PILL} min-w-0 border-destructive/40 text-destructive`}
			>
				<span className="size-1.5 shrink-0 rounded-full bg-destructive" />
				Offline
				{reason === null ? null : (
					<span className="truncate font-normal">{reason}</span>
				)}
			</span>
			<button
				type="button"
				disabled={retrying}
				onClick={() => {
					setRetrying(true);
					retry();
				}}
				className={`${STATUS_PILL} text-muted-foreground hover:text-foreground disabled:opacity-70`}
			>
				{retrying && (
					<LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
				)}
				{retrying ? "Retrying…" : "Retry"}
			</button>
		</span>
	);
}

/** How long Retry says it is retrying, about as long as a try takes to fail. */
const RETRYING = Duration.secs(3);

/**
 * Says in a desktop's bar, beside the title, that the server cannot be
 * reached, once the page has stopped waiting on it. Before that it says nothing.
 */
export function StaleChip(): JSX.Element | null {
	const { unreachable, reason } = useFreshness();
	return unreachable ? <OfflinePill reason={reason} /> : null;
}
