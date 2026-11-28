import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { type CSSProperties, type JSX, type ReactNode, useState } from "react";
import { Tabs, TabsContent } from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import { AppStatus } from "./app-header";
import { AppNav } from "./app-nav";
import { BESIDE_PANE } from "./changes";
import { useCheckpoint } from "./checkpoint";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { OfflineBanner, useFreshness } from "./freshness";
import { useShortcut } from "./hooks/use-shortcut";
import { pageArea } from "./page-areas";
import type { PageMenu } from "./page-menu";
import type { Page } from "./page-route";
import { Sidebar } from "./sidebar";
import { SidebarHead } from "./sidebar-head";
import type { Terminals } from "./terminals";
import { TopBar, TopBarFrame } from "./top-bar";

/**
 * How each page sits beside a sidebar, under its integrated header band. The
 * board runs as wide as its lanes, the way a Trello board scrolls sideways.
 */
const DESKTOP_PAGES: Record<Page, string> = {
	boards: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	// As tall as the inset panel under its header band, so the board's scrollbar
	// sits on the panel's bottom edge.
	todos: "flex min-h-0 flex-col px-4 pt-3.5",
	// A board too, as tall and as wide.
	tasks: "flex min-h-0 flex-col px-4 pt-3.5",
	stats: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	ships: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	// Rigs in one column, as on a phone.
	rigs: "mx-auto w-full min-w-0 max-w-2xl px-4 pt-5 pb-8",
	rec: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	// Test reports sit beside a run sidebar, so wider than one column.
	creds: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	// A list beside a signal's detail, so wider than one column.
	signals: "mx-auto w-full min-w-0 max-w-5xl px-4 pt-5 pb-8",
	trust: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	billing: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	"auto-pick": "mx-auto w-full min-w-0 max-w-5xl px-4 pt-5 pb-8",
	setup: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	welcome: "mx-auto w-full min-w-0 max-w-3xl px-4 pt-5 pb-8",
	// A thread reaches across its right padding, so its scrollbar sits at the
	// window's edge (`--thread-bleed-end`).
	conversations:
		"flex min-h-0 flex-col px-4 pb-4 [--thread-bleed-end:--spacing(4)]",
};

/** Full-viewport workspaces that manage their own scrolling inside the inset panel. */
const FULL_VIEWPORT_PAGES = new Set<Page>(["conversations", "todos", "tasks"]);

/**
 * The app laid out for a wide screen. Render it with the `page` to show and
 * `bodies`, what each page holds.
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
	onSettings,
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
	onSettings: () => void;
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
	useShortcut("shortcuts.sidebarPages", () => sidebar.toggleMore());
	const { unreachable, reason } = useFreshness();
	const { restartBusy } = useCheckpoint();
	// Where each page's integrated header band and any banner under it go.
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const [bannerSlot, setBannerSlot] = useState<HTMLElement | null>(null);
	const fullViewport = bodies !== null && FULL_VIEWPORT_PAGES.has(page);
	const area =
		bodies !== null && page !== "conversations" && page !== "welcome"
			? pageArea(page)
			: null;
	const frame = {
		refreshing: restartBusy,
		slot,
		bannerSlot,
		banner: (offline || unreachable) && <OfflineBanner reason={reason} />,
		project: name,
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
		stuck: menu.stuck,
		onInvestigateStuck: menu.onInvestigateStuck,
		area: area === null ? undefined : { page, sidebarHidden: !shown },
	};
	return (
		<TopBarFrame value={frame}>
			<Tabs
				data-sidebar-layout=""
				value={page}
				onValueChange={(value) => go(value as Page)}
				orientation="vertical"
				// Neutral sidebar frame around the rounded inset main panel.
				className={cn(
					"h-dvh flex-col gap-0 overflow-hidden bg-sidebar p-2",
					shown ? "pl-(--sidebar-width)" : "pl-2",
					paned && BESIDE_PANE,
				)}
				style={
					{
						"--sidebar-width": `${width}px`,
					} as CSSProperties
				}
			>
				<SidebarHead name={name} sidebar={sidebar} />
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
					onSettings={onSettings}
				/>
				<div
					data-desktop-panel
					className={cn(
						"flex min-h-0 min-w-0 flex-1 flex-col rounded-[14px] border border-foreground/[0.07] bg-background",
						fullViewport ? "overflow-hidden" : "overflow-y-auto",
					)}
				>
					{/* Welcome, saved runs, and loading use the slim toolbar. */}
					<header
						ref={setSlot}
						data-page-area={area?.area}
						className={cn(
							"z-30 shrink-0",
							area === null
								? cn(
										"sticky top-0 flex h-(--top-bar-height) items-center gap-1 bg-background pr-2 pl-4",
										!shown && "pl-(--top-bar-start)",
									)
								: "page-header-band sticky top-0 min-h-(--top-bar-height)",
						)}
					/>
					<div ref={setBannerSlot} className="contents" />
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
									className={DESKTOP_PAGES[value]}
								>
									{bodies[value]}
								</TabsContent>
							))
					)}
				</div>
			</Tabs>
		</TopBarFrame>
	);
}
