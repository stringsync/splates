import { useReactive } from "@webappwiz/react";
import { type JSX, type ReactNode, useSyncExternalStore } from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { TabsList, TabsTrigger } from "#dev/components/ui/tabs.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Snapshot } from "../snapshot";
import type { ConversationFeed } from "./conversation-feed";
import { ConversationList } from "./conversation-list";
import { openRequests } from "./creds";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey } from "./hooks/use-shortcut";
import { NewMenu } from "./new-menu";
import { PAGES, type Page } from "./page-route";
import { UpdateDot } from "./release";
import type { ShortcutKey } from "./settings";
import { type Sidebar, SidebarHandle } from "./sidebar";
import type { Terminals } from "./terminals";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
export const WIDE = "(min-width: 768px)";

/**
 * The page's tabs in a sidebar down the left, under New, each with what it
 * counts, the conversation list under them, and a handle to drag it wider,
 * unless it is hidden. A phone has
 * its own layout, `PhoneApp`, in place of it.
 */
export function AppNav({
	available,
	snapshot,
	page,
	open,
	onOpen,
	talk,
	terminals,
	drafts,
	sidebar,
}: {
	/** Whether `arbor dev` holds conversations. */
	available: boolean;
	snapshot: Snapshot | null;
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	onOpen: (id: string | null) => void;
	talk: ConversationFeed;
	terminals: Terminals;
	drafts: Drafts;
	sidebar: Sidebar;
}): JSX.Element {
	const held = useHeld();
	const { shown } = useReactive(
		sidebar,
		(sidebar) => ({ shown: sidebar.shown }),
		["changed"],
	);
	const pages = PAGES.filter(
		({ value }) => value !== "conversations" || available,
	);
	// Todos and Tasks count what they list; Conversations counts nothing, as
	// the list under it says what waits. None shows for nothing.
	const count = (page: Page) => {
		const counting =
			snapshot === null ||
			page === "conversations" ||
			page === "systems" ||
			page === "stats" ||
			page === "creds" ||
			page === "budget"
				? 0
				: (page === "todos" ? snapshot.todos : snapshot.tasks).length;
		return counting === 0 ? null : counting;
	};
	// Creds counts nothing: a dot says a request waits on the person.
	const requested =
		snapshot !== null && openRequests(snapshot.creds).length > 0;
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
					<NewMenu
						feed={talk}
						terminals={terminals}
						open={page === "conversations" ? open : null}
						onOpen={onOpen}
					/>
				)}
				{pages.map(({ value, label, Icon, shortcut }) => (
					<TabsTrigger
						key={value}
						value={value}
						className="h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-primary"
					>
						<span className="relative flex">
							<Icon />
							{value === "creds" && requested && (
								<span role="img" aria-label="creds requested">
									<UpdateDot ring="ring-sidebar" />
								</span>
							)}
						</span>
						<span className="flex-1 text-left">{label}</span>
						<HeldOr shortcut={shortcut} held={held}>
							{count(value) !== null && (
								<span className="text-muted-foreground tabular-nums">
									{count(value)}
								</span>
							)}
						</HeldOr>
					</TabsTrigger>
				))}
				{/* Under their tab, so one is a click away from any page. */}
				{available && snapshot !== null && (
					<div className="-mx-3 mt-4 min-h-0 flex-1 overflow-y-auto border-t px-3 pt-4 pb-6">
						<ConversationList
							feed={talk}
							terminals={terminals}
							drafts={drafts}
							tasks={snapshot.tasks}
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

/** A page's shortcut key while ⌥⌘ is held, or else `children`. */
function HeldOr({
	shortcut,
	held,
	children,
}: {
	shortcut: ShortcutKey | undefined;
	held: boolean;
	children: ReactNode;
}): ReactNode {
	const key = useHeldKey(shortcut);
	return held && key !== null ? <Kbd aria-hidden>{key}</Kbd> : children;
}
