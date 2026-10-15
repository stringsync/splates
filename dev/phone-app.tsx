import { useReactive } from "@webappwiz/react";
import { MenuIcon, SquarePenIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../snapshot";
import { SlotMark } from "./app-header";
import { NEW } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import type { Move } from "./page-address";
import type { PageMenu } from "./page-menu";
import type { Page } from "./page-route";
import { Drawer } from "./phone-drawer";
import { Inbox } from "./phone-inbox";
import { Screen } from "./phone-screen";
import { NextWaiting } from "./phone-thread";
import { ProjectSwitcher } from "./projects";
import type { Terminals } from "./terminals";
import { BarButton, TopBarFrame } from "./top-bar";

/**
 * The page on a phone, a layout of its own beside the sidebar's: the inbox of
 * agents is home, an open conversation takes the whole screen with its own way
 * back, and every other page sits under a bar whose menu opens the drawer and
 * whose pen, as the inbox's, starts a new conversation, then how many agents
 * wait on you, at the end of every bar but the inbox's. The inbox and every
 * page the drawer goes to are headed by the slot's mark and the project
 * switcher rather than a title, so another project is a tap away. Every bar's kebab holds the page
 * menu.
 * What each page shows, `body`, is the same as on a wide screen.
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
	/** The project's header, which heads the drawer. */
	header: ReactNode;
	/** Whether the server stopped answering, said beside the name. */
	offline: boolean;
	/** The page shown, or what says it is on its way. */
	body: ReactNode;
	/** Whether `arbor dev` holds conversations. */
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
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const { conversations } = useReactive(
		talk,
		(talk) => ({ conversations: talk.conversations }),
		["changed"],
	);
	useHomeIsInbox(available, page, go);
	const menu = () => setDrawer(true);
	// The page menu, in every bar's kebab, so it is always at hand.
	const kebab = { menu: pageMenu.items, dot: pageMenu.dot };
	const project = (
		<div className="flex min-w-0 items-center gap-2">
			<SlotMark snapshot={snapshot} />
			<ProjectSwitcher name={name} />
		</div>
	);
	// The drawer's header says more, as why the server is outdated.
	const status = offline && (
		<span
			role="status"
			className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-medium text-[11px] text-destructive leading-none"
		>
			<span className="size-1.5 rounded-full bg-destructive" />
			Offline
		</span>
	);
	return (
		<div className="min-h-dvh">
			{page === "conversations" && open === null && snapshot !== null ? (
				<TopBarFrame value={kebab}>
					<Inbox
						feed={talk}
						drafts={drafts}
						terminals={terminals}
						tasks={snapshot.tasks}
						project={project}
						status={status}
						onMenu={menu}
						onOpen={(id) => go("conversations", id)}
					/>
				</TopBarFrame>
			) : page === "conversations" ? (
				<Screen className="px-1">
					{/* Every conversation's bar ends with how many others wait. */}
					<TopBarFrame
						value={{
							...kebab,
							end: snapshot !== null && (
								<NextWaiting
									feed={talk}
									drafts={drafts}
									tasks={snapshot.tasks}
									open={open}
									onOpen={(id) => go("conversations", id)}
								/>
							),
						}}
					>
						{body}
					</TopBarFrame>
				</Screen>
			) : (
				<div data-bounce>
					{/* The page's own bar lands in the middle, as every other's
					    does beside a sidebar. */}
					<header className="sticky top-0 z-30 box-content flex h-(--top-bar-height) items-center gap-1 border-b bg-background/95 px-1 pt-[env(safe-area-inset-top)] backdrop-blur">
						<BarButton label="Open menu" onClick={menu}>
							<MenuIcon />
						</BarButton>
						<div
							ref={setSlot}
							className="flex min-w-0 flex-1 items-center gap-1"
						/>
						{available && (
							<BarButton
								label="New conversation"
								onClick={() => go("conversations", NEW)}
							>
								<SquarePenIcon />
							</BarButton>
						)}
						{available && snapshot !== null && (
							<NextWaiting
								feed={talk}
								drafts={drafts}
								tasks={snapshot.tasks}
								open={null}
								onOpen={(id) => go("conversations", id)}
							/>
						)}
					</header>
					<TopBarFrame value={{ ...kebab, slot, status, project }}>
						{body}
					</TopBarFrame>
				</div>
			)}
			<Drawer
				open={drawer}
				onOpenChange={setDrawer}
				header={header}
				page={page}
				conversation={open}
				available={available}
				waiting={waiting}
				archived={conversations.filter((each) => each.archived).length}
				snapshot={snapshot}
				onGo={go}
			/>
		</div>
	);
}

/**
 * Opens the inbox in place of the board when the address names no page, as
 * the phone's home is its agents, once conversations are known to be held.
 */
function useHomeIsInbox(
	available: boolean,
	page: Page,
	go: (page: Page, conversation: null, how: Move) => void,
): void {
	const landed = useRef(false);
	useEffect(() => {
		if (!available || landed.current) {
			return;
		}
		landed.current = true;
		if (page === "todos" && location.hash === "") {
			go("conversations", null, "replace");
		}
	}, [available, page, go]);
}
