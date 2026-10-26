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
}

const FRESH: Freshness = {
	stale: false,
	unreachable: false,
	locked: false,
	reason: null,
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
	useEffect(() => {
		setWaited(false);
		if (!stale) {
			return;
		}
		const waiting = setTimeout(() => setWaited(true), feed.offlineAfter.ms);
		return () => clearTimeout(waiting);
	}, [stale, feed]);
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
		() => ({ stale, unreachable, locked, reason: snapshot.failure }),
		[stale, unreachable, locked, snapshot.failure],
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
 * of preview. Their count cannot predict the loaded inbox's groups and folders.
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
 * What the sidebar shows in place of its rows before its first listing of
 * every project: rows shaped like its own, a mark and a name. Their count
 * cannot predict the loaded list's folders.
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
 * The error the page shows once it gave up waiting: the server cannot be
 * reached. The page is unlocked by then, so what it shows can be read and
 * copied; the streams reopen by themselves, so it offers no Retry.
 */
export function OfflinePill({
	reason = null,
}: {
	reason?: string | null;
}): JSX.Element {
	return (
		<span
			role="alert"
			title={`splates server stopped answering: is it still running? The page keeps trying.${reason === null ? "" : ` Last read: ${reason}`}`}
			className={`${STATUS_PILL} border-destructive/40 text-destructive`}
		>
			<span className="size-1.5 rounded-full bg-destructive" />
			Offline
			{reason === null ? null : (
				<span className="truncate font-normal">{reason}</span>
			)}
		</span>
	);
}

/**
 * Says in a desktop's bar, beside the title, that the server cannot be
 * reached, once the page has stopped waiting on it. Before that it says nothing.
 */
export function StaleChip(): JSX.Element | null {
	const { unreachable, reason } = useFreshness();
	return unreachable ? <OfflinePill reason={reason} /> : null;
}
