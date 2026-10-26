import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { ArchiveIcon, FolderPlusIcon, InboxIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { ARCHIVED } from "./conversation-address";
import { openRequests } from "./creds";
import { useNavPages } from "./evals-available";
import { OrphansDot } from "./orphans";
import type { Move } from "./page-address";
import { navPage, type Page } from "./page-route";
import { AddProjectDialog } from "./project-controls";
import { ProjectSwitcher } from "./projects";
import { UpdateDot } from "./release";
import { RestartButton } from "./restart-button";
import { SetupDot } from "./setup-state";
import { NAV_HEADING } from "./top-bar";

/**
 * The phone's way to every page, slid in from the left as in the Claude and
 * ChatGPT apps: the server's header up top, the inbox of every project first,
 * then the project's pages under its switcher, then those of every project
 * under Everywhere, then Add a project, and the archived conversations last. The
 * pages it opens take each other's place in history above the inbox, even while it loads, so back from any of them goes home, as Android's
 * top-level destinations do.
 */
export function Drawer({
	open,
	onOpenChange,
	header,
	name,
	page,
	conversation,
	available,
	waiting,
	archived,
	orphans,
	snapshot,
	update,
	onGo,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The server's header: its name and its status. */
	header: ReactNode;
	/** The project's name. */
	name: string;
	page: Page;
	/** The conversation open, by its address, or null. */
	conversation: string | null;
	/** Whether `splates server` holds conversations. */
	available: boolean;
	/** The agents waiting on you. */
	waiting: number;
	/** How many conversations are archived. */
	archived: number;
	/** How many tasks no agent is left on. */
	orphans: number;
	snapshot: Snapshot | null;
	/** Whether a restart would update splates. */
	update: boolean;
	/** Goes to `page`, with `conversation` open there, as `how` leaves history. */
	onGo: (page: Page, conversation: string | null, how: Move) => void;
}): JSX.Element {
	const pages = useNavPages();
	const home = (page: Page, conversation: string | null) =>
		page === "conversations" && conversation === null;
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
	const [adding, setAdding] = useState(false);
	const entry = ({ value, label, Icon }: (typeof pages)[number]) => (
		<Entry
			key={value}
			current={navPage(page) === value}
			onClick={() => go(value)}
			icon={
				<span className="relative flex">
					<Icon />
					{value === "creds" && requested && (
						<span role="img" aria-label="creds requested">
							<UpdateDot ring="ring-sidebar" />
						</span>
					)}
					{value === "tasks" && orphans > 0 && (
						<OrphansDot ring="ring-sidebar" />
					)}
					{value === "setup" && <SetupDot ring="ring-sidebar" />}
				</span>
			}
			label={label}
		/>
	);
	return (
		<>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
			<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
					<DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
						<DialogPrimitive.Title className="sr-only">
							Pages
						</DialogPrimitive.Title>
						{header}
						<nav className="flex flex-col gap-0.5 p-2">
							<Entry
								current={page === "conversations" && conversation === null}
								onClick={() => go("conversations")}
								icon={<InboxIcon />}
								label="Inbox"
								count={waiting}
								urgent
							/>
							<ProjectSwitcher
								name={name}
								heading
								keyed={false}
								path={false}
								servers={false}
								className="mx-0 mt-3 h-10 px-3"
							/>
							{pages.filter(({ scope }) => scope === "project").map(entry)}
							<h2 className={cn(NAV_HEADING, "mt-3 py-2")}>Everywhere</h2>
							{pages.filter(({ scope }) => scope === "everywhere").map(entry)}
							<Entry
								current={false}
								onClick={() => {
									onOpenChange(false);
									setAdding(true);
								}}
								icon={<FolderPlusIcon />}
								label="Add a project"
							/>
						</nav>
						{/* Update and Archived stay at the foot. */}
						<div className="mt-auto">
							{/* Update, from any screen, while one waits or runs. */}
							<div className="flex flex-col border-t p-2 empty:hidden [&>button]:w-full">
								<RestartButton wide={false} update={update} />
							</div>
							{available && (
								<div className="border-t p-2">
									<Entry
										current={conversation === ARCHIVED}
										onClick={() => go("conversations", ARCHIVED)}
										icon={<ArchiveIcon />}
										label="Archived"
										count={archived}
									/>
								</div>
							)}
						</div>
					</DialogPrimitive.Popup>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
}

/** One of the drawer's pages, a finger's height, with what it counts, if anything. */
function Entry({
	current,
	onClick,
	icon,
	label,
	count = 0,
	urgent = false,
}: {
	current: boolean;
	onClick: () => void;
	icon: ReactNode;
	label: string;
	count?: number;
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
