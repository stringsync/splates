import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { ChevronUpIcon, MoreHorizontalIcon, SettingsIcon } from "lucide-react";
import { type JSX, type ReactNode, useSyncExternalStore } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { TabsList, TabsTrigger } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import type { ConversationFeed } from "./conversation-feed";
import { ArchivedEntry, ConversationList } from "./conversation-list";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcutLabel } from "./hooks/use-shortcut";
import { NavMenuItem, navMenuItemClass } from "./nav-menu-item";
import { NavCountBadge, NavIcon, useNavStatuses } from "./nav-status";
import { NewConversation } from "./new-conversation-button";
import { NextWaiting } from "./next-waiting";
import { pageArea } from "./page-areas";
import { navPage, PAGES, type Page } from "./page-route";
import type { ShortcutKey } from "./settings";
import { type Sidebar, SidebarHandle } from "./sidebar";
import type { Terminals } from "./terminals";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
export const WIDE = "(min-width: 768px)";

const PRIMARY_ORDER: readonly Page[] = ["boards", "signals", "ships", "rec"];
const PRIMARY_PAGES = PRIMARY_ORDER.flatMap((id) =>
	PAGES.filter((entry) => entry.value === id),
);
const SECONDARY_PAGES = PAGES.filter(
	(entry) => !PRIMARY_ORDER.includes(entry.value),
);

/**
 * The wide screen's sidebar: New conversation and active conversations stay
 * prominent near the top, with Workspace pages below (secondary ones tucked
 * behind More), and Archived and Settings at the foot. A phone uses `PhoneApp`.
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
	onSettings,
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
	onSettings: () => void;
}): JSX.Element {
	const held = useHeld();
	const moreKey = useShortcutLabel("shortcuts.sidebarPages");
	const settingsKey = useShortcutLabel("shortcuts.settings");

	const { shown, moreShown } = useReactive(
		sidebar,
		(sidebar) => ({
			shown: sidebar.shown,
			moreShown: sidebar.moreShown,
		}),
		["changed"],
	);
	const statuses = useNavStatuses(snapshot);
	const currentNav = navPage(page);
	const tab = (
		{ value, label, Icon, shortcut }: (typeof PAGES)[number],
		hidden = false,
	) => {
		const status = statuses[value];
		return (
			<TabsTrigger
				key={value}
				value={value === currentNav ? page : value}
				data-page-area={pageArea(value).area}
				onClick={() => {
					// A tab for the page already open fires no change, so Rec, whose
					// History and sessions sit under it, goes back to its start here.
					if (value === "boards" || (value === "rec" && page === "rec")) {
						onPage(value);
					}
				}}
				aria-current={value === currentNav ? "page" : undefined}
				// Collapsed, a tab stays mounted so its shortcut and selection still resolve.
				hidden={hidden}
				className={cn(
					navMenuItemClass({
						current: value !== page && value === currentNav,
					}),
					"after:hidden group-data-[variant=line]/tabs-list:hover:bg-muted/60 group-data-[variant=line]/tabs-list:data-active:bg-accent group-data-[variant=line]/tabs-list:data-active:hover:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:hover:bg-accent data-active:font-medium data-active:text-foreground dark:data-active:text-foreground",
					// Marked too while a page under it is open.
					value !== page &&
						value === currentNav &&
						"group-data-[variant=line]/tabs-list:bg-accent",
				)}
			>
				<NavIcon icon={Icon} status={status?.icon} />
				<span className="flex-1 text-left">{label}</span>
				{status?.badge !== undefined && (
					<NavCountBadge
						count={status.badge.count}
						tone={status.badge.tone}
						label={status.badge.label}
					/>
				)}
				<HeldKey shortcut={shortcut} held={held} />
			</TabsTrigger>
		);
	};

	const hiddenAttention =
		!moreShown &&
		SECONDARY_PAGES.some(
			({ value }) => value !== currentNav && statuses[value] !== undefined,
		);
	const moreTitle = moreKey === null ? undefined : `More pages (${moreKey})`;

	return (
		<>
			<TabsList
				variant="line"
				className={cn(
					"fixed inset-y-0 left-0 z-40 w-(--sidebar-width) items-stretch justify-start gap-1 bg-sidebar px-3 pt-[calc(var(--top-bar-height)+0.5rem)] data-vertical:h-dvh",
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
				{available && snapshot !== null && (
					<div className="-mx-3 flex min-h-0 flex-1 flex-col px-3">
						<div className="px-3 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
							Conversations
						</div>
						{/* Up and Down move between these rows; the tabs around them would take the keys too. */}
						{/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps keys from the tabs */}
						<div
							className="-mx-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3"
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
					</div>
				)}
				<div className="flex shrink-0 flex-col gap-1 pt-1">
					<div className="px-2.5 pt-1 pb-1 font-medium text-muted-foreground text-xs">
						Workspace
					</div>
					<div
						data-sidebar-pages=""
						className={cn(
							"-mx-3 flex flex-col gap-1 px-3",
							moreShown && "max-h-[42dvh] overflow-y-auto",
						)}
					>
						{PRIMARY_PAGES.map((entry) => tab(entry, false))}
						{SECONDARY_PAGES.map((entry) =>
							tab(entry, !moreShown && entry.value !== currentNav),
						)}
						<NavMenuItem
							muted
							aria-expanded={moreShown}
							title={moreTitle}
							onClick={() => sidebar.toggleMore()}
							icon={
								moreShown ? (
									<ChevronUpIcon aria-hidden />
								) : (
									<MoreHorizontalIcon aria-hidden />
								)
							}
							label={moreShown ? "Less" : `More (${SECONDARY_PAGES.length})`}
							badge={
								hiddenAttention ? (
									<span
										role="img"
										aria-label="More pages need attention"
										className="size-1.5 rounded-full bg-warning"
									/>
								) : undefined
							}
						/>
					</div>
				</div>
				<div className="-mx-3 mt-auto flex flex-col gap-1 border-t px-3 py-2 empty:hidden">
					{available && snapshot !== null && (
						<ArchivedEntry
							open={page === "conversations" ? open : null}
							onOpen={onOpen}
						/>
					)}
					<NavMenuItem
						onClick={onSettings}
						icon={<SettingsIcon aria-hidden />}
						label="Settings"
						badge={
							settingsKey === null ? undefined : (
								<span
									aria-hidden
									className="text-xs tracking-widest text-muted-foreground"
								>
									{settingsKey}
								</span>
							)
						}
					/>
				</div>
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
