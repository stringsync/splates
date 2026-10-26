import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type CSSProperties, type JSX, type ReactNode, useState } from "react";
import { Tabs, TabsContent } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import { AppStatus } from "./app-header";
import { AppNav } from "./app-nav";
import { BESIDE_PANE } from "./changes";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { useFreshness } from "./freshness";
import { useShortcut } from "./hooks/use-shortcut";
import type { PageMenu } from "./page-menu";
import type { Page } from "./page-route";
import { Sidebar } from "./sidebar";
import { SidebarHead } from "./sidebar-head";
import type { Terminals } from "./terminals";
import { TopBar, TopBarFrame } from "./top-bar";

/**
 * How each page sits beside a sidebar, under its bar. The board runs as wide
 * as its lanes, the way a Trello board scrolls sideways.
 */
const DESKTOP_PAGES: Record<Page, string> = {
	// As tall as the window under its bar, so the board's scrollbar sits on
	// the window's bottom edge.
	todos:
		"flex h-[calc(100dvh-var(--top-bar-height))] min-w-0 flex-none flex-col px-4",
	tasks: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	stats: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	evals: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	creds: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	billing: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	automations: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	"auto-pick": "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	setup: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-2 pb-6",
	// A thread reaches across its right padding, so its scrollbar sits at the
	// window's edge (`--thread-bleed-end`).
	conversations: "min-w-0 px-4 pb-4 [--thread-bleed-end:--spacing(4)]",
};

/**
 * The page beside a sidebar, a layout of its own beside the phone's: one
 * row of bars across the top, the sidebar's head floating at its left with
 * the project's switcher and the button that hides the sidebar,
 * and each page's own bar in the rest, whose kebab ends with the page menu.
 * Under them, the sidebar's tabs and the page. The sidebar keeps its width
 * and whether it shows for the next visit. What each page shows, `bodies`,
 * is the same as on a phone. The phone's inbox stays the phone's: with no
 * conversation open, the sidebar lists the agents, and the page starts one.
 */
export function DesktopApp({
	page,
	open,
	go,
	name,
	bodies,
	opening,
	paned,
	available,
	snapshot,
	outdated,
	offline,
	talk,
	drafts,
	terminals,
	menu,
}: {
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	go: (page: Page, conversation?: string | null) => void;
	/** The project's name. */
	name: string;
	/** What each page shows, or null before the first snapshot. */
	bodies: Record<Page, ReactNode> | null;
	/** What says the project is on its way, in place of the pages. */
	opening: ReactNode;
	/** Whether a pane stands at the right, which the page leaves clear. */
	paned: boolean;
	/** Whether `splates server` holds conversations. */
	available: boolean;
	snapshot: Snapshot | null;
	/** Why a newer splates has the server refusing, or null. */
	outdated: string | null;
	offline: boolean;
	talk: ConversationFeed;
	drafts: Drafts;
	terminals: Terminals;
	menu: PageMenu;
}): JSX.Element {
	const [sidebar] = useState(() => new Sidebar(localStorage));
	const { width, shown } = useReactive(
		sidebar,
		(sidebar) => ({ width: sidebar.width, shown: sidebar.shown }),
		["changed"],
	);
	// A terminal keeps ⌃B for itself, as tmux's prefix, off a Mac.
	useShortcut("shortcuts.sidebar", (event) =>
		event.target instanceof Element && event.target.closest(".xterm") !== null
			? false
			: sidebar.toggle(),
	);
	useShortcut("shortcuts.sidebarPages", () => sidebar.togglePages());
	// The page takes no input while locked.
	const { locked } = useFreshness();
	// Where each page's bar goes: the row atop the page.
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const frame = {
		slot,
		status: (
			<AppStatus
				snapshot={snapshot}
				outdated={outdated}
				offline={offline}
				machine={menu.machine}
			/>
		),
		menu: menu.items,
		dot: menu.dot,
	};
	return (
		<TopBarFrame value={frame}>
			<Tabs
				data-sidebar-layout=""
				value={page}
				onValueChange={(value) => go(value as Page)}
				orientation="vertical"
				// Clear of the sidebar.
				className={cn(
					"min-h-dvh flex-col gap-0",
					shown && "pl-(--sidebar-width)",
					paned && BESIDE_PANE,
				)}
				style={{ "--sidebar-width": `${width}px` } as CSSProperties}
			>
				<SidebarHead snapshot={snapshot} sidebar={sidebar} name={name} />
				{/* Every page's bar lands here, one row with the sidebar's head,
				    and clear of it once it hides. */}
				<header
					ref={setSlot}
					className={cn(
						"sticky top-0 z-30 flex h-(--top-bar-height) shrink-0 items-center gap-1 bg-background pr-2 pl-4",
						!shown && "pl-(--top-bar-start)",
					)}
				/>
				<AppNav
					available={available}
					snapshot={snapshot}
					page={page}
					open={open}
					onOpen={(id) => go("conversations", id)}
					onPage={(to) => go(to)}
					talk={talk}
					terminals={terminals}
					drafts={drafts}
					sidebar={sidebar}
				/>
				{bodies === null ? (
					<>
						{/* Bare, for the status and the page menu it ends with. */}
						<TopBar title="" />
						{opening}
					</>
				) : (
					// Every page, those out of the nav, as Setup, too.
					(Object.keys(DESKTOP_PAGES) as Page[])
						.filter((value) => value !== "conversations" || available)
						.map((value) => (
							<TabsContent
								key={value}
								value={value}
								inert={locked}
								aria-busy={locked}
								className={DESKTOP_PAGES[value]}
							>
								{bodies[value]}
							</TabsContent>
						))
				)}
			</Tabs>
		</TopBarFrame>
	);
}
