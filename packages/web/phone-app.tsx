import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { MenuIcon, SquarePenIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "#web/components/ui/dropdown-menu.tsx";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { OfflinePill, useFreshness } from "./freshness";
import { MergeBadge } from "./merge-badge";
import { ShownRoot, useOpenNew } from "./new-conversation-project";
import { orphanCount } from "./orphans";
import type { Move } from "./page-address";
import type { PageMenu } from "./page-menu";
import type { Page } from "./page-route";
import { Drawer } from "./phone-drawer";
import { Inbox } from "./phone-inbox";
import { Screen } from "./phone-screen";
import { WaitingBadge } from "./phone-thread";
import { QueueBadge } from "./slot-queue";
import type { Terminals } from "./terminals";
import { BarButton, TopBarFrame } from "./top-bar";

/**
 * The page on a phone, a layout of its own beside the sidebar's: the inbox of
 * agents is home, an open conversation takes the whole screen with its own way
 * back, and every other page sits under a bar whose menu opens the drawer.
 * How many agents wait on you marks the way out of every screen but the
 * inbox, which lists them: a conversation's way back, and a page's menu.
 * Branding and the project switcher head the drawer. Every bar's kebab holds
 * the page menu, and a page's starts a new conversation too, as the inbox's
 * pen does.
 * What each page shows, `body`, is the same as on a wide screen.
 */
export function PhoneApp({
	page,
	open,
	go,
	openLane,
	name,
	header,
	offline,
	body,
	available,
	waiting,
	snapshot,
	talk,
	drafts,
	terminals,
	pageMenu,
}: {
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	go: (page: Page, conversation?: string | null, how?: Move) => void;
	/** Opens the board on lane `id`. */
	openLane: (id: number) => void;
	/** The project's name. */
	name: string;
	/** The server's header, which heads the drawer. */
	header: ReactNode;
	/** Whether the server stopped answering, said beside the name. */
	offline: boolean;
	/** The page shown, or what says it is on its way. */
	body: ReactNode;
	/** Whether `splates server` holds conversations. */
	available: boolean;
	/** The agents waiting on you. */
	waiting: number;
	snapshot: Snapshot | null;
	talk: ConversationFeed;
	drafts: Drafts;
	terminals: Terminals;
	pageMenu: PageMenu;
}): JSX.Element {
	const [drawer, setDrawer] = useState(false);
	// In the project the last one started in, which may be another's page.
	const openNew = useOpenNew((open) => go("conversations", open));
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const { conversations } = useReactive(
		talk,
		(talk) => ({ conversations: talk.conversations }),
		["changed"],
	);
	useHomeIsInbox(page, go);
	const menu = () => setDrawer(true);
	// The page menu, in every bar's kebab, so it is always at hand.
	const kebab = { menu: pageMenu.items, dot: pageMenu.dot };
	// The drawer's header says more, as why the server is outdated.
	const { unreachable, reason } = useFreshness();
	const status =
		offline || unreachable ? (
			<OfflinePill reason={reason} />
		) : (
			<>
				<MergeBadge snapshot={snapshot} />
				<QueueBadge queue={pageMenu.machine?.queue ?? []} />
			</>
		);
	return (
		<ShownRoot value={snapshot?.root ?? null}>
			<div className="min-h-dvh">
				{page === "conversations" && open === null ? (
					<TopBarFrame value={kebab}>
						<Inbox
							feed={talk}
							drafts={drafts}
							terminals={terminals}
							tasks={snapshot?.tasks ?? []}
							todos={snapshot?.todos ?? []}
							here={
								snapshot === null
									? null
									: {
											root: snapshot.root,
											repo: snapshot.repo,
											trunk: snapshot.trunk,
										}
							}
							loading={snapshot === null}
							status={status}
							onMenu={menu}
							onOpen={(id) => go("conversations", id)}
							onLane={openLane}
						/>
					</TopBarFrame>
				) : page === "conversations" ? (
					<Screen
						// A thread reaches across the right padding, so its scrollbar
						// sits at the screen's edge (`--thread-bleed-end`).
						className="px-1 [--thread-bleed-end:--spacing(1)]"
					>
						{/* Every conversation's way back counts how many others wait. */}
						<TopBarFrame
							value={{
								...kebab,
								// An update is for the screens above a conversation.
								dot: undefined,
								badge: snapshot !== null && (
									<WaitingBadge
										feed={talk}
										tasks={snapshot.tasks}
										open={open}
									/>
								),
							}}
						>
							{body}
						</TopBarFrame>
					</Screen>
				) : (
					<div>
						{/* The page's own bar lands in the middle, as every other's
					    does beside a sidebar. */}
						<header className="sticky top-0 z-30 box-content flex h-(--top-bar-height) items-center gap-1 border-b bg-background/95 px-1 pt-[env(safe-area-inset-top)] backdrop-blur">
							<span className="relative flex shrink-0">
								<BarButton label="Open menu" onClick={menu}>
									<MenuIcon />
								</BarButton>
								{snapshot !== null && (
									<WaitingBadge
										feed={talk}
										tasks={snapshot.tasks}
										open={null}
									/>
								)}
							</span>
							<div
								ref={setSlot}
								className="flex min-w-0 flex-1 items-center gap-1"
							/>
						</header>
						<TopBarFrame
							value={{
								...kebab,
								menu: (
									<>
										{available && (
											<>
												<DropdownMenuItem onClick={() => openNew()}>
													<SquarePenIcon />
													New conversation
												</DropdownMenuItem>
												<DropdownMenuSeparator />
											</>
										)}
										{pageMenu.items}
									</>
								),
								slot,
								status,
								project: name,
							}}
						>
							{body}
						</TopBarFrame>
					</div>
				)}
				<Drawer
					open={drawer}
					onOpenChange={setDrawer}
					header={header}
					name={name}
					page={page}
					conversation={open}
					available={available}
					waiting={waiting}
					archived={conversations.filter((each) => each.archived).length}
					orphans={
						available && snapshot !== null
							? orphanCount(snapshot.tasks, conversations)
							: 0
					}
					snapshot={snapshot}
					update={pageMenu.dot}
					onGo={go}
				/>
			</div>
		</ShownRoot>
	);
}

/**
 * Opens the inbox in place of the board when the address names no page, as
 * the phone's home is its agents, even before they load.
 */
function useHomeIsInbox(
	page: Page,
	go: (page: Page, conversation: null, how: Move) => void,
): void {
	const landed = useRef(false);
	useEffect(() => {
		if (landed.current) {
			return;
		}
		landed.current = true;
		if (page === "todos" && location.hash === "") {
			go("conversations", null, "replace");
		}
	}, [page, go]);
}
