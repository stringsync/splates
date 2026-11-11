import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { type JSX, type ReactNode, useSyncExternalStore } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { TabsList, TabsTrigger } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import { ArchivedEntry, ConversationList } from "./conversation-list";
import { openRequests } from "./creds";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcutLabel } from "./hooks/use-shortcut";
import { useMachine } from "./machine";
import { NewConversation } from "./new-conversation-button";
import { NextWaiting } from "./next-waiting";
import { OrphansDot, orphanCount } from "./orphans";
import { navPage, PAGES, type Page } from "./page-route";
import { UpdateDot } from "./release";
import type { ShortcutKey } from "./settings";
import { SetupDot } from "./setup-state";
import { hasActiveShip, shipActivity } from "./ship-activity";
import { useAcknowledged } from "./ship-recap-seen";
import { type Sidebar, SidebarHandle } from "./sidebar";
import type { Terminals } from "./terminals";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
/** The dot on the Ships icon for each thing the ship can ask of the person. */
const SHIP_DOTS = {
	running: { label: "a ship runs", color: "animate-pulse bg-primary" },
	waiting: { label: "a ship waits on you", color: "bg-warning" },
	error: { label: "the ship failed", color: "bg-destructive" },
	done: { label: "a ship recap is ready", color: "bg-green-500" },
};

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

	const { shown, pagesShown } = useReactive(
		sidebar,
		(sidebar) => ({ shown: sidebar.shown, pagesShown: sidebar.pagesShown }),
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
	const reading = useMachine()?.ship;
	const acknowledged = useAcknowledged();
	const shipping = shipActivity(reading, acknowledged);
	const tab = ({ value, label, Icon, shortcut }: (typeof PAGES)[number]) => (
		<TabsTrigger
			key={value}
			value={value === navPage(page) ? page : value}
			onClick={() => {
				// A tab for the page already open fires no change, so Rec, whose
				// History and sessions sit under it, goes back to its start here.
				if (value === "boards" || (value === "rec" && page === "rec")) {
					onPage(value);
				}
				// With a ship under way, the Ship tab opens it rather than the planner.
				if (value === "ships" && hasActiveShip(reading, acknowledged)) {
					location.hash = "ships/active";
				}
			}}
			aria-current={value === navPage(page) ? "page" : undefined}
			// Folded, a tab stays mounted, so it still answers to its shortcut.
			hidden={!pagesShown}
			className={cn(
				"h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-primary",
				// Marked too while a page under it is open.
				value !== page &&
					value === navPage(page) &&
					"group-data-[variant=line]/tabs-list:bg-accent [&_svg]:text-primary",
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
				{value === "ships" && shipping !== null && (
					<span role="img" aria-label={SHIP_DOTS[shipping].label}>
						<UpdateDot ring="ring-sidebar" color={SHIP_DOTS[shipping].color} />
					</span>
				)}
			</span>
			<span className="flex-1 text-left">{label}</span>
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
				{PAGES.filter(({ scope }) => scope === "project").map(tab)}
				{PAGES.filter(({ scope }) => scope === "everywhere").map(tab)}
				{/* Under their tab, so one is a click away from any page. */}
				{available && snapshot !== null && (
					<PagesFold sidebar={sidebar} shown={pagesShown} />
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
							here={{
								root: snapshot.root,
								repo: snapshot.repo,
								trunk: snapshot.trunk,
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

/**
 * The border between the sidebar's tabs and its agents, with a button on it
 * (the whole line is its target) that folds the tabs away and unfolds them again.
 */
function PagesFold({
	sidebar,
	shown,
}: {
	sidebar: Sidebar;
	/** Whether the tabs show, unfolded. */
	shown: boolean;
}): JSX.Element {
	const key = useShortcutLabel("shortcuts.sidebarPages");
	const label = shown ? "Fold pages" : "Show pages";
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
				title={key === null ? label : `${label} (${key})`}
				onClick={() => sidebar.togglePages()}
				className="group absolute inset-x-0 top-1/2 flex h-5 -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground outline-none hover:text-foreground"
			>
				<span
					aria-hidden
					className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-foreground/25 opacity-0 transition-opacity group-hover:opacity-100"
				/>
				<span className="relative flex size-5 items-center justify-center rounded-full border bg-sidebar shadow-xs transition-colors group-hover:border-foreground/40 group-focus-visible:ring-3 group-focus-visible:ring-ring/50 [&_svg]:size-3">
					{shown ? <ChevronUpIcon /> : <ChevronDownIcon />}
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
