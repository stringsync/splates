import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, type ReactNode, useSyncExternalStore } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { TabsList, TabsTrigger } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import { ArchivedEntry, ConversationList } from "./conversation-list";
import { openRequests } from "./creds";
import type { Drafts } from "./drafts";
import { useNavPages } from "./evals-available";
import { useHeld } from "./hooks/use-held";
import { useHeldKey } from "./hooks/use-shortcut";
import { NewConversation } from "./new-conversation-button";
import { NextWaiting } from "./next-waiting";
import { OrphansDot, orphanCount } from "./orphans";
import { navPage, type Page } from "./page-route";
import { UpdateDot } from "./release";
import type { ShortcutKey } from "./settings";
import { SetupDot } from "./setup-state";
import { type Sidebar, SidebarHandle } from "./sidebar";
import type { Terminals } from "./terminals";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
export const WIDE = "(min-width: 768px)";

/**
 * The page's tabs in a sidebar down the left, under New, each with its
 * shortcut while ⌥⌘ is held, the agents under them, atop them a line to the next waiting, Archived at the foot, and a handle to drag it wider,
 * unless it is hidden. A phone has
 * its own layout, `PhoneApp`, in place of it.
 */
export function AppNav({
	available,
	snapshot,
	page,
	open,
	onOpen,
	onLane,
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
	/** Opens the board on lane `id`. */
	onLane: (id: number) => void;
	talk: ConversationFeed;
	terminals: Terminals;
	drafts: Drafts;
	sidebar: Sidebar;
}): JSX.Element {
	const held = useHeld();
	const pages = useNavPages();
	const { shown } = useReactive(
		sidebar,
		(sidebar) => ({ shown: sidebar.shown }),
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
	return (
		<>
			{/* Below the row of bars, where its head floats. Hidden, it stays
			    mounted, so its tabs still answer to the page's shortcuts. */}
			<TabsList
				variant="line"
				className={cn(
					"fixed inset-y-0 left-0 z-40 w-(--sidebar-width) items-stretch justify-start gap-1 border-r bg-sidebar px-3 pt-(--top-bar-height) group-data-vertical/tabs:h-dvh",
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
				{pages.map(({ value, label, Icon, shortcut }) => (
					<TabsTrigger
						key={value}
						value={value}
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
							{value === "tasks" && orphans > 0 && (
								<OrphansDot ring="ring-sidebar" />
							)}
							{value === "setup" && <SetupDot ring="ring-sidebar" />}
						</span>
						<span className="flex-1 text-left">{label}</span>
						<HeldKey shortcut={shortcut} held={held} />
					</TabsTrigger>
				))}
				{/* Under their tab, so one is a click away from any page. */}
				{available && snapshot !== null && (
					<div className="-mx-3 mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t px-3 pt-4 pb-4">
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
							onLane={onLane}
						/>
					</div>
				)}
				{available && snapshot !== null && (
					<div className="-mx-3 border-t px-3 py-2">
						<ArchivedEntry
							feed={talk}
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
