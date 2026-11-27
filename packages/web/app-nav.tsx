import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	CircleAlertIcon,
	LoaderCircleIcon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { TabsList, TabsTrigger } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import { ArchivedEntry, ConversationList } from "./conversation-list";
import { openRequests } from "./creds";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcutLabel } from "./hooks/use-shortcut";
import { NewConversation } from "./new-conversation-button";
import { NextWaiting } from "./next-waiting";
import { OrphansDot, orphanCount } from "./orphans";
import { pageArea } from "./page-areas";
import { navPage, PAGES, type Page } from "./page-route";
import { UpdateDot } from "./release";
import type { ShortcutKey } from "./settings";
import { SetupDot } from "./setup-state";
import { ShipRecapIndicator } from "./ship-recap-indicator";
import { type Sidebar, SidebarHandle } from "./sidebar";
import type { Terminals } from "./terminals";
import { useAutoPickImprovements } from "./use-auto-pick-improvements";
import {
	useShipFailed,
	useShipsRunning,
	useShipsWaiting,
} from "./use-ships-waiting";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
export const WIDE = "(min-width: 768px)";

/**
 * The wide screen's sidebar: render it beside the page to move between its
 * tabs and agents. A phone uses `PhoneApp` instead.
 */
export function AppNav({
	available,
	snapshot,
	page,
	open,
	onOpen,
	onPage,
	talk,
	terminals,
	drafts,
	sidebar,
}: {
	/** Whether `splates server` holds conversations. */
	available: boolean;
	snapshot: Snapshot | null;
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	onOpen: (id: string | null) => void;
	/** Goes to another page. */
	onPage: (page: Page) => void;
	talk: ConversationFeed;
	terminals: Terminals;
	drafts: Drafts;
	sidebar: Sidebar;
}): JSX.Element {
	// The project's tabs, under New with each shortcut while ⌥⌘ is held, then
	// Everywhere's; the agents of every project under them with a line to the
	// next waiting atop, Archived at the foot, and a handle to drag it wider.
	// A button on the border folds the tabs away for room for the agents.
	const held = useHeld();
	const pagesRef = useRef<HTMLDivElement | null>(null);
	const [draggingPages, setDraggingPages] = useState(false);

	const { shown, pagesShown, pagesHeight } = useReactive(
		sidebar,
		(sidebar) => ({
			shown: sidebar.shown,
			pagesShown: sidebar.pagesShown,
			pagesHeight: sidebar.pagesHeight,
		}),
		["changed"],
	);
	// Creds counts nothing: a dot says a request waits on the person.
	const requested =
		snapshot !== null && openRequests(snapshot.creds).length > 0;
	const { conversations } = useReactive(
		talk,
		(talk) => ({ conversations: talk.conversations }),
		["changed"],
	);
	const orphans =
		available && snapshot !== null
			? orphanCount(snapshot.tasks, conversations)
			: 0;
	const asking = useShipsWaiting().length;
	const improvements = useAutoPickImprovements()?.count ?? 0;
	const shipsRunning = useShipsRunning();
	const shipFailed = useShipFailed();
	const tab = ({ value, label, Icon, shortcut }: (typeof PAGES)[number]) => (
		<TabsTrigger
			key={value}
			value={value === navPage(page) ? page : value}
			data-page-area={pageArea(value).area}
			onClick={() => {
				// A tab for the page already open fires no change, so Rec, whose
				// History and sessions sit under it, goes back to its start here.
				if (value === "boards" || (value === "rec" && page === "rec")) {
					onPage(value);
				}
			}}
			aria-current={value === navPage(page) ? "page" : undefined}
			// Folded, a tab stays mounted, so it still answers to its shortcut.
			hidden={!pagesShown && !draggingPages}
			className={cn(
				"h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-(--area-hue)",
				// Marked too while a page under it is open.
				value !== page &&
					value === navPage(page) &&
					"group-data-[variant=line]/tabs-list:bg-accent [&_svg]:text-(--area-hue)",
			)}
		>
			<span className="relative flex">
				<Icon />
				{value === "creds" && requested && (
					<span role="img" aria-label="creds requested">
						<UpdateDot ring="ring-sidebar" />
					</span>
				)}
				{value === "tasks" && orphans > 0 && <OrphansDot ring="ring-sidebar" />}
				{value === "setup" && <SetupDot ring="ring-sidebar" />}
			</span>
			<span className="flex-1 text-left">{label}</span>
			{value === "ships" && shipsRunning && (
				<LoaderCircleIcon
					role="status"
					aria-label="a ship runs"
					className="size-4 animate-spin text-muted-foreground"
				/>
			)}
			{value === "ships" && shipFailed && !shipsRunning && (
				<CircleAlertIcon
					role="status"
					aria-label="Ship stopped on a failure"
					className="size-4 !text-destructive"
				/>
			)}
			{value === "ships" && <ShipRecapIndicator />}
			{value === "auto-pick" && improvements > 0 && (
				<span
					role="status"
					aria-label={`${improvements} possible ${improvements === 1 ? "improvement" : "improvements"}`}
					className="rounded-full bg-warning px-1.5 font-medium text-background text-xs tabular-nums"
				>
					{improvements}
				</span>
			)}
			{value === "ships" && asking > 0 && (
				<span
					role="status"
					aria-label={`${asking} waiting on you`}
					className="rounded-full bg-warning px-1.5 font-medium text-background text-xs tabular-nums"
				>
					{asking}
				</span>
			)}
			<HeldKey shortcut={shortcut} held={held} />
		</TabsTrigger>
	);
	return (
		<>
			{/* Below the row of bars, where its head floats. Hidden, it stays
			    mounted, so its tabs still answer to the page's shortcuts. */}
			<TabsList
				variant="line"
				className={cn(
					"fixed inset-y-0 left-0 z-40 w-(--sidebar-width) items-stretch justify-start gap-1 border-r bg-sidebar px-3 pt-(--top-bar-height) data-vertical:h-dvh",
					!shown && "hidden",
				)}
			>
				{available && (
					<NewConversation
						drafts={drafts}
						terminals={terminals}
						onOpen={onOpen}
					/>
				)}
				<div
					ref={pagesRef}
					data-sidebar-pages=""
					style={
						available && snapshot !== null && pagesShown && pagesHeight !== null
							? { height: `${pagesHeight}px` }
							: undefined
					}
					className={cn(
						"-mx-3 flex shrink-0 flex-col gap-1 px-3",
						available &&
							snapshot !== null &&
							(draggingPages || (pagesShown && pagesHeight !== null)) &&
							"overflow-y-auto",
						!pagesShown && !draggingPages && "hidden",
					)}
				>
					{PAGES.filter(({ scope }) => scope === "project").map(tab)}
					{PAGES.filter(({ scope }) => scope === "everywhere").map(tab)}
				</div>
				{/* Under their tab, so one is a click away from any page. */}
				{available && snapshot !== null && (
					<PagesFold
						sidebar={sidebar}
						shown={pagesShown}
						pagesHeight={pagesHeight}
						pagesRef={pagesRef}
						onDraggingChange={setDraggingPages}
					/>
				)}
				{available && snapshot !== null && (
					// Up and Down move between these rows; the tabs around them would take the keys too.
					// biome-ignore lint/a11y/noStaticElementInteractions: only keeps keys from the tabs
					<div
						className="-mx-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-4 pb-4"
						onKeyDown={(event) => {
							if (event.key === "ArrowUp" || event.key === "ArrowDown") {
								event.stopPropagation();
							}
						}}
					>
						<NextWaiting
							feed={talk}
							tasks={snapshot.tasks}
							todos={snapshot.todos}
							here={{
								root: snapshot.root,
								repo: snapshot.repo,
								trunk: snapshot.trunk,
							}}
							open={page === "conversations" ? open : null}
							onOpen={onOpen}
						/>
						<ConversationList
							feed={talk}
							terminals={terminals}
							tasks={snapshot.tasks}
							todos={snapshot.todos}
							lanes={snapshot.lanes}
							boards={snapshot.boards}
							here={{
								root: snapshot.root,
								repo: snapshot.repo,
								trunk: snapshot.trunk,
								queueError: snapshot.queueError,
							}}
							open={page === "conversations" ? open : null}
							onOpen={onOpen}
						/>
					</div>
				)}
				{available && snapshot !== null && (
					<div className="-mx-3 border-t px-3 py-2">
						<ArchivedEntry
							open={page === "conversations" ? open : null}
							onOpen={onOpen}
						/>
					</div>
				)}
			</TabsList>
			{shown && <SidebarHandle sidebar={sidebar} />}
		</>
	);
}

/** Whether the window is `WIDE` right now, following it as it resizes. */
export function useWide(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(WIDE);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(WIDE).matches,
	);
}

/** Pixels of vertical movement before a pointer press becomes a drag. */
const PAGES_DRAG_THRESHOLD = 4;
/** Dragging shorter than this folds the pages away completely. */
const PAGES_FOLD_THRESHOLD = 20;
/** Dragging within this many pixels of full height snaps back to natural height. */
const PAGES_FULL_SNAP_THRESHOLD = 12;
/** How far an arrow key nudges the pages height. */
const PAGES_STEP = 36;

/**
 * The border between the sidebar's tabs and its agents: drag vertically to
 * resize the pages list, or click to reset a custom height (and fold/unfold
 * when at full height or folded).
 */
function PagesFold({
	sidebar,
	shown,
	pagesHeight,
	pagesRef,
	onDraggingChange,
}: {
	sidebar: Sidebar;
	/** Whether the tabs show, unfolded. */
	shown: boolean;
	/** Custom height in pixels, or null when at natural height or folded. */
	pagesHeight: number | null;
	pagesRef: RefObject<HTMLDivElement | null>;
	onDraggingChange: (dragging: boolean) => void;
}): JSX.Element {
	const key = useShortcutLabel("shortcuts.sidebarPages");
	const suppressClick = useRef(false);
	const custom = shown && pagesHeight !== null;
	const label = custom
		? "Reset pages height"
		: shown
			? "Fold pages"
			: "Show pages";
	const title = custom
		? "Drag to resize, click to reset"
		: key === null
			? `${label}, drag to resize`
			: `${label} (${key}), drag to resize`;

	const drag = (event: PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) {
			return;
		}
		const handle = event.currentTarget;
		const pages = pagesRef.current;
		if (pages === null) {
			return;
		}
		const startY = event.clientY;
		const startHeight = shown
			? (pagesHeight ?? pages.getBoundingClientRect().height)
			: 0;
		let dragged = false;
		let currentHeight = startHeight;
		let naturalHeight = shown ? pages.scrollHeight : 0;

		const move = (moved: globalThis.PointerEvent) => {
			const delta = moved.clientY - startY;
			if (!dragged) {
				if (Math.abs(delta) < PAGES_DRAG_THRESHOLD) {
					return;
				}
				dragged = true;
				handle.setPointerCapture(event.pointerId);
				onDraggingChange(true);
				pages.style.height = `${startHeight}px`;
			}
			if (naturalHeight === 0 && pages.scrollHeight > 0) {
				naturalHeight = pages.scrollHeight;
			}
			const raw = Math.round(startHeight + delta);
			currentHeight =
				naturalHeight > 0
					? Math.max(0, Math.min(naturalHeight, raw))
					: Math.max(0, raw);
			pages.style.height = `${currentHeight}px`;
		};

		const end = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			if (!dragged) {
				return;
			}
			suppressClick.current = true;
			setTimeout(() => {
				suppressClick.current = false;
			}, 0);
			const finalNatural = pages.scrollHeight || naturalHeight;
			pages.style.height = "";
			onDraggingChange(false);
			if (currentHeight < PAGES_FOLD_THRESHOLD) {
				sidebar.setPagesHeight(0);
			} else if (
				finalNatural > 0 &&
				currentHeight >= finalNatural - PAGES_FULL_SNAP_THRESHOLD
			) {
				sidebar.setPagesHeight(null);
			} else {
				sidebar.setPagesHeight(currentHeight);
			}
			sidebar.keepPagesHeight();
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	};

	const click = () => {
		if (suppressClick.current) {
			suppressClick.current = false;
			return;
		}
		if (pagesHeight !== null) {
			sidebar.resetPagesHeight();
		} else {
			sidebar.togglePages();
		}
	};

	const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
		const by =
			event.key === "ArrowUp"
				? -PAGES_STEP
				: event.key === "ArrowDown"
					? PAGES_STEP
					: 0;
		if (by === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const pages = pagesRef.current;
		const natural = pages?.scrollHeight ?? 0;
		const current = !shown ? 0 : (pagesHeight ?? natural);
		const next = current + by;
		if (next <= 0) {
			sidebar.setPagesHeight(0);
		} else if (natural > 0 && next >= natural) {
			sidebar.setPagesHeight(null);
		} else {
			sidebar.setPagesHeight(next);
		}
		sidebar.keepPagesHeight();
	};

	return (
		<div
			className={cn(
				"relative -mx-3 mb-3 h-px shrink-0 bg-border",
				shown ? "mt-4" : "mt-3",
			)}
		>
			<button
				type="button"
				aria-label={label}
				aria-expanded={shown}
				title={title}
				onPointerDown={drag}
				onClick={click}
				onKeyDown={nudge}
				className="group absolute inset-x-0 top-1/2 flex h-5 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center text-muted-foreground outline-none hover:text-foreground"
			>
				<span
					aria-hidden
					className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-foreground/25 opacity-0 transition-opacity group-hover:opacity-100"
				/>
				<span className="relative flex size-5 items-center justify-center rounded-full border bg-sidebar shadow-xs transition-colors group-hover:border-foreground/40 group-focus-visible:ring-3 group-focus-visible:ring-ring/50 [&_svg]:size-3">
					{shown && !custom ? <ChevronUpIcon /> : <ChevronDownIcon />}
				</span>
			</button>
		</div>
	);
}

/** A page's shortcut key while ⌥⌘ is held. */
function HeldKey({
	shortcut,
	held,
}: {
	shortcut: ShortcutKey | undefined;
	held: boolean;
}): ReactNode {
	const key = useHeldKey(shortcut);
	return held && key !== null ? <Kbd aria-hidden>{key}</Kbd> : null;
}
