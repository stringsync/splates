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
import { PAGES, type Page } from "./page-route";
import { UpdateDot } from "./release";
import type { ShortcutKey } from "./settings";
import { SidebarHandle, type SidebarWidth } from "./sidebar";
import type { Terminals } from "./terminals";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
const WIDE = "(min-width: 768px)";

/**
 * The page's tabs, each with what it counts: with room to spare, a sidebar
 * down the left, the conversation list under the tabs, and a handle to drag
 * it wider; on a phone, a bar along the bottom.
 */
export function AppNav({
	wide,
	available,
	waiting,
	snapshot,
	page,
	open,
	onOpen,
	talk,
	terminals,
	drafts,
	sidebar,
}: {
	wide: boolean;
	/** Whether `arbor dev` holds conversations. */
	available: boolean;
	/** The agents waiting on you, 0 when none or none are counted. */
	waiting: number;
	snapshot: Snapshot | null;
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	onOpen: (id: string | null) => void;
	talk: ConversationFeed;
	terminals: Terminals;
	drafts: Drafts;
	sidebar: SidebarWidth;
}): JSX.Element {
	const held = useHeld();
	const pages = PAGES.filter(
		({ value }) => value !== "conversations" || available,
	);
	// Todos and Tasks count what they list; Conversations counts only the
	// agents waiting on you, and only on a phone, since on a wide screen the
	// sidebar's own list says so. None shows for nothing.
	const count = (page: Page) => {
		const counting =
			page === "conversations"
				? !wide
					? waiting
					: 0
				: snapshot === null || page === "stats" || page === "creds"
					? 0
					: (page === "todos" ? snapshot.todos : snapshot.tasks).length;
		return counting === 0 ? null : counting;
	};
	// Creds counts nothing: a dot says a request waits on the person.
	const requested =
		snapshot !== null && openRequests(snapshot.creds).length > 0;
	return (
		<>
			{/* With room to spare, a sidebar down the left. On a phone, a bar
								    along the bottom, where a thumb already is; a dialog sits over
								    it. */}
			<TabsList
				variant="line"
				className={
					wide
						? // Below the header.
							"fixed inset-y-0 left-0 z-40 w-(--sidebar-width) items-stretch justify-start gap-1 border-r bg-sidebar px-3 pt-20 group-data-vertical/tabs:h-dvh"
						: "fixed inset-x-0 bottom-0 z-40 w-full justify-around rounded-none border-t bg-background/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur group-data-horizontal/tabs:h-auto"
				}
			>
				{pages.map(({ value, label, Icon, shortcut }) => (
					<TabsTrigger
						key={value}
						value={value}
						className={
							wide
								? "h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-primary"
								: "h-auto flex-1 flex-col gap-0.5 py-1 text-xs after:hidden data-active:[&_svg]:text-primary"
						}
					>
						<span className="relative flex">
							<Icon className={cn(!wide && "size-5")} />
							{value === "creds" && requested && (
								<span role="img" aria-label="creds requested">
									<UpdateDot ring={wide ? "ring-sidebar" : "ring-background"} />
								</span>
							)}
						</span>
						<span className={cn(wide && "flex-1 text-left")}>
							{label}
							{!wide && count(value) !== null && ` ${count(value)}`}
						</span>
						{wide && (
							<HeldOr shortcut={shortcut} held={held}>
								{count(value) !== null && (
									<span className="text-muted-foreground tabular-nums">
										{count(value)}
									</span>
								)}
							</HeldOr>
						)}
					</TabsTrigger>
				))}
				{/* Under their tab, so one is a click away from any page. */}
				{wide && available && snapshot !== null && (
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
			{wide && <SidebarHandle sidebar={sidebar} />}
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
