import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArchiveIcon, InboxIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Snapshot } from "../snapshot";
import { ARCHIVED } from "./conversation-address";
import { openRequests } from "./creds";
import type { Move } from "./page-address";
import { PAGES, type Page } from "./page-route";
import { UpdateDot } from "./release";

/**
 * The phone's way to every page, slid in from the left as in the Claude and
 * ChatGPT apps: the project's header up top, the inbox first, then the other
 * pages, each with what it counts, and the archived conversations last. The
 * pages it opens take each other's place in history above home, the inbox or
 * the board without one, so back from any of them goes home, as Android's
 * top-level destinations do.
 */
export function Drawer({
	open,
	onOpenChange,
	header,
	page,
	conversation,
	available,
	waiting,
	archived,
	snapshot,
	onGo,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The project's header: its switcher, its status, and the page menu. */
	header: ReactNode;
	page: Page;
	/** The conversation open, by its address, or null. */
	conversation: string | null;
	/** Whether `arbor dev` holds conversations. */
	available: boolean;
	/** The agents waiting on you. */
	waiting: number;
	/** How many conversations are archived. */
	archived: number;
	snapshot: Snapshot | null;
	/** Goes to `page`, with `conversation` open there, as `how` leaves history. */
	onGo: (page: Page, conversation: string | null, how: Move) => void;
}): JSX.Element {
	const home = (page: Page, conversation: string | null) =>
		available
			? page === "conversations" && conversation === null
			: page === "todos";
	const go = (to: Page, open: string | null = null) => {
		// Home is pushed, so the move back to it goes back instead.
		onGo(
			to,
			open,
			home(page, conversation) || home(to, open) ? "push" : "replace",
		);
		onOpenChange(false);
	};
	const requested =
		snapshot !== null && openRequests(snapshot.creds).length > 0;
	const count = (page: Page) =>
		snapshot === null
			? 0
			: page === "todos"
				? snapshot.todos.length
				: page === "tasks"
					? snapshot.tasks.length
					: 0;
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
					<DialogPrimitive.Title className="sr-only">
						Pages
					</DialogPrimitive.Title>
					{header}
					<nav className="flex flex-col gap-0.5 p-2">
						{available && (
							<Entry
								current={page === "conversations" && conversation === null}
								onClick={() => go("conversations")}
								icon={<InboxIcon />}
								label="Inbox"
								count={waiting}
								urgent
							/>
						)}
						{PAGES.filter(({ value }) => value !== "conversations").map(
							({ value, label, Icon }) => (
								<Entry
									key={value}
									current={page === value}
									onClick={() => go(value)}
									icon={
										<span className="relative flex">
											<Icon />
											{value === "creds" && requested && (
												<span role="img" aria-label="creds requested">
													<UpdateDot ring="ring-sidebar" />
												</span>
											)}
										</span>
									}
									label={label}
									count={count(value)}
								/>
							),
						)}
					</nav>
					{available && (
						<div className="mt-auto border-t p-2">
							<Entry
								current={conversation === ARCHIVED}
								onClick={() => go("conversations", ARCHIVED)}
								icon={<ArchiveIcon />}
								label="Archived"
								count={archived}
							/>
						</div>
					)}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** One of the drawer's pages, a finger's height, with what it counts. */
function Entry({
	current,
	onClick,
	icon,
	label,
	count,
	urgent = false,
}: {
	current: boolean;
	onClick: () => void;
	icon: ReactNode;
	label: string;
	count: number;
	/** Whether its count waits on you, and so stands out. */
	urgent?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-current={current ? "page" : undefined}
			onClick={onClick}
			className={cn(
				"flex h-12 items-center gap-3 rounded-lg px-3 text-left text-base [&_svg]:size-5 [&_svg]:text-muted-foreground active:bg-accent",
				current && "bg-accent font-medium [&_svg]:text-primary",
			)}
		>
			{icon}
			<span className="flex-1">{label}</span>
			{count > 0 && (
				<span
					className={cn(
						"text-sm tabular-nums",
						urgent
							? "rounded-full bg-warning px-2 py-0.5 font-medium text-background"
							: "text-muted-foreground",
					)}
				>
					{count}
				</span>
			)}
		</button>
	);
}
