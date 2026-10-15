import { useReactive } from "@webappwiz/react";
import { MenuIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../snapshot";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import type { Move } from "./page-address";
import { PAGES, type Page } from "./page-route";
import { Drawer } from "./phone-drawer";
import { IconButton, Inbox } from "./phone-inbox";
import { Screen } from "./phone-screen";
import type { Terminals } from "./terminals";

/**
 * The page on a phone, a layout of its own beside the sidebar's: the inbox of
 * agents is home, an open conversation takes the whole screen with its own way
 * back, and every other page sits under a bar whose menu opens the drawer.
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
}): JSX.Element {
	const [drawer, setDrawer] = useState(false);
	const { conversations } = useReactive(
		talk,
		(talk) => ({ conversations: talk.conversations }),
		["changed"],
	);
	useHomeIsInbox(available, page, go);
	const menu = () => setDrawer(true);
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
				<Inbox
					feed={talk}
					drafts={drafts}
					terminals={terminals}
					tasks={snapshot.tasks}
					name={name}
					status={status}
					onMenu={menu}
					onOpen={(id) => go("conversations", id)}
				/>
			) : page === "conversations" ? (
				<Screen className="px-1">{body}</Screen>
			) : (
				<div data-bounce>
					<header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
						<IconButton label="Open menu" onClick={menu}>
							<MenuIcon />
						</IconButton>
						<h1 className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-base">
							<span className="truncate">
								{PAGES.find((each) => each.value === page)?.label}
							</span>
							{status}
						</h1>
					</header>
					{body}
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
