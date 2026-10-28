import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { MenuIcon, SquarePenIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { NEW } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { OfflinePill, useFreshness } from "./freshness";
import { orphanCount } from "./orphans";
import type { Move } from "./page-address";
import type { PageMenu } from "./page-menu";
import type { Page } from "./page-route";
import { PageChips } from "./phone-chips";
import { Drawer } from "./phone-drawer";
import { Inbox } from "./phone-inbox";
import { Screen } from "./phone-screen";
import { WaitingBadge } from "./phone-thread";
import { ProjectSwitcher } from "./projects";
import type { Terminals } from "./terminals";
import { BarButton, TopBarFrame } from "./top-bar";

/**
 * The page on a phone, in place of the sidebar's layout: render it with the
 * page's `body`, which it shows as a wide screen does, under its own bars.
 */
export function PhoneApp({
	page,
	open,
	go,
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
	// The inbox is home; an open conversation takes the whole screen with its
	// own way back, and every other page sits under a bar whose menu opens the
	// drawer. How many agents wait on you marks the way out of every screen but
	// the inbox. The project is every bar's title, which switches it, with a
	// row of its pages under it and a pen to start a conversation; every bar's
	// kebab holds the page menu, and the server's status past offline is the
	// drawer's.
	const [drawer, setDrawer] = useState(false);
	// Closed on a switch of project, picked in it or not.
	const [of, setOf] = useState(talk);
	if (of !== talk) {
		setOf(talk);
		setDrawer(false);
	}
	const openNew = (open: string = NEW) => go("conversations", open);
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const { conversations } = useReactive(
		talk,
		(talk) => ({ conversations: talk.conversations }),
		["changed"],
	);
	useHomeIsInbox(page, go);
	const menu = () => setDrawer(true);
	// The page menu, in every bar's kebab, so it is always at hand.
	const kebab = { menu: pageMenu.items, dot: pageMenu.dot, project: name };
	// The drawer's header says more, as why the server is outdated, and what
	// merges and queues.
	const { unreachable, reason } = useFreshness();
	const status = (offline || unreachable) && <OfflinePill reason={reason} />;
	const chips = <PageChips page={page} onGo={go} />;
	return (
		<div className="min-h-dvh">
			{page === "conversations" && open === null ? (
				<TopBarFrame value={kebab}>
					<Inbox
						feed={talk}
						drafts={drafts}
						terminals={terminals}
						tasks={snapshot?.tasks ?? []}
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
						chips={chips}
						onMenu={menu}
						onOpen={(id) => go("conversations", id)}
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
								<WaitingBadge feed={talk} tasks={snapshot.tasks} open={open} />
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
								<WaitingBadge feed={talk} tasks={snapshot.tasks} open={null} />
							)}
						</span>
						<ProjectSwitcher
							name={name}
							path={false}
							servers={false}
							className="mx-0 max-w-3/5 shrink"
						/>
						<div
							ref={setSlot}
							className="flex min-w-0 flex-1 items-center gap-1"
						/>
					</header>
					{chips}
					<TopBarFrame
						value={{
							...kebab,
							slot,
							status,
							untitled: true,
							end: available && (
								<BarButton label="New conversation" onClick={() => openNew()}>
									<SquarePenIcon />
								</BarButton>
							),
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
				orphans={
					available && snapshot !== null
						? orphanCount(snapshot.tasks, conversations)
						: 0
				}
				snapshot={snapshot}
				onGo={go}
			/>
		</div>
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
