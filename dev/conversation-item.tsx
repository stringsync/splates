import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	CheckIcon,
	CircleDotIcon,
	EllipsisVerticalIcon,
	LinkIcon,
	PencilIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";
import { namedForTask, openingOf } from "../conversation-name";
import type { ConversationState } from "../conversations";
import type { Need } from "../needs";
import { AgentIcon } from "./agent-icons";
import { copiedLabel, useCopy } from "./card";
import {
	archiveConversation,
	markUnread,
	renameConversation,
} from "./conversation-api";
import { reportedAs, unnamed, useNameOf } from "./conversation-names";
import { Trunk, whereRuns } from "./dispatching";
import { useHandedOutBy, useHandedTo } from "./handed-out";
import { Mark } from "./mark";
import { Refusal, type Refuse, useRefusal } from "./refusal";
import { ShellRunning, ShowTerminal } from "./terminal";

/**
 * One conversation in a list: its agent's mark, its name, and whether it
 * needs you, its name muted for one that answers to another. Hovered or focused, it offers Archive (or Unarchive) and a menu.
 */
export function Item({
	conversation,
	agent,
	need,
	current,
	onOpen,
	onLeft,
	where = false,
	hint = null,
	hosting = false,
}: {
	conversation: ConversationState;
	agent: string;
	need: Need;
	current: boolean;
	onOpen: () => void;
	/** Once archived, to go on from it, as for the one open. */
	onLeft?: () => void;
	/** Whether to say where it ran, rather than only on hover. */
	where?: boolean;
	/** The key that opens it with ⌥⌘, while ⌥⌘ is held. */
	hint?: string | null;
	/** Whether an agent it handed a task to is at work. */
	hosting?: boolean;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const nameOf = useNameOf();
	const [renaming, setRenaming] = useState(false);
	const { copied, copy } = useCopy();
	const trunk = useContext(Trunk);
	const { id, archived } = conversation;
	const { refusal, refuse } = useRefusal();
	const { file, confirm, files } = useArchive(conversation, refuse);
	// One that answers to another is that one's to rename and archive.
	const handedOut = useHandedOutBy(conversation) !== null;
	const reported = reportedAs(conversation);
	const Put = archived ? ArchiveRestoreIcon : ArchiveIcon;
	const put = archived ? "Unarchive" : "Archive";
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			{renaming && (
				<Rename
					conversation={conversation}
					refuse={refuse}
					onDone={() => setRenaming(false)}
				/>
			)}
			{confirm}
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				onDoubleClick={() => setRenaming(!handedOut)}
				title={where ? undefined : (conversation.task ?? undefined)}
				// Room for the buttons only while they show, and for a mark while
				// there is one.
				className={cn(
					// A touch screen has no hover, so its buttons always show.
					"flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left group-focus-within/item:pr-14 group-hover/item:pr-14 pointer-coarse:pr-24",
					renaming && "hidden",
					menu
						? "pr-14"
						: need.kind === "idle" &&
								!hosting &&
								(handedOut || (reported === null && !conversation.unread)) &&
								hint === null
							? "pr-3"
							: "pr-6",
				)}
			>
				<AgentIcon
					agent={conversation.agent}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						// One that answers to another is not yours to address.
						(unnamed(conversation) || handedOut) &&
							"text-muted-foreground italic",
					)}
				>
					{nameOf(conversation)}
				</span>
				{where && whereOf(conversation, trunk) !== null && (
					<span className="shrink-0 truncate text-muted-foreground text-xs">
						{whereOf(conversation, trunk)}
					</span>
				)}
			</button>
			<span
				className={cn(
					"pointer-events-none absolute right-2 flex items-center pointer-coarse:right-16",
					renaming && "hidden",
					menu
						? "hidden"
						: hint === null &&
								"group-focus-within/item:hidden group-hover/item:hidden",
				)}
			>
				{hint !== null ? (
					<Kbd aria-hidden>{hint}</Kbd>
				) : (
					<Mark
						need={need}
						reported={reported}
						unread={conversation.unread}
						hosting={hosting}
						subagent={handedOut}
					/>
				)}
			</span>
			<span
				className={cn(
					"absolute right-1 flex items-center",
					// Its keys show in their place while ⌥⌘ is held.
					(renaming || (hint !== null && !menu)) && "hidden",
					!menu &&
						"opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100",
				)}
			>
				<DropdownMenu open={menu} onOpenChange={setMenu}>
					<DropdownMenuTrigger
						render={
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`More for ${nameOf(conversation)}`}
							/>
						}
					>
						<EllipsisVerticalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-44">
						<DropdownMenuItem
							closeOnClick={false}
							title={copied.state === "failed" ? copied.error : undefined}
							onClick={() =>
								copy(
									`${location.origin}${location.pathname}#conversations/${id}`,
								)
							}
						>
							{copied.state === "copied" ? <CheckIcon /> : <LinkIcon />}
							<span aria-live="polite">{copiedLabel(copied, "Copy link")}</span>
						</DropdownMenuItem>
						{!handedOut && (
							<DropdownMenuItem onClick={() => setRenaming(true)}>
								<PencilIcon />
								Rename
							</DropdownMenuItem>
						)}
						{/* The one open would be read again at once. */}
						{!current && !conversation.unread && !archived && (
							<DropdownMenuItem
								onClick={() =>
									void markUnread(id, true).catch((error: unknown) =>
										refuse("Not marked unread", error),
									)
								}
							>
								<CircleDotIcon />
								Mark as unread
							</DropdownMenuItem>
						)}
						{files && (
							<DropdownMenuItem
								onClick={() => file(archived ? undefined : onLeft)}
							>
								<Put />
								{put}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				{files && (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`${put} ${nameOf(conversation)}`}
						onClick={() => file(archived ? undefined : onLeft)}
					>
						<Put />
					</Button>
				)}
			</span>
			<Refusal refusal={refusal} className="w-full px-3 pb-1.5" />
		</div>
	);
}

/**
 * Archives `conversation`, or brings it back, then runs `then`. While its
 * agent works, or its shell is up, `file` asks first in
 * `confirm`, since archiving stops both; render `confirm` beside whatever
 * calls `file`.
 */
export function useArchive(
	conversation: ConversationState,
	refuse: Refuse,
): {
	file: (then?: () => void) => void;
	confirm: JSX.Element;
	/**
	 * Whether the person may archive it or bring it back: not one that answers
	 * to another, which goes and comes back with that one.
	 */
	files: boolean;
} {
	const [asking, setAsking] = useState(false);
	// Held while `confirm` asks.
	const after = useRef<(() => void) | undefined>(undefined);
	const shellRunning = useContext(ShellRunning);
	const showTerminal = useContext(ShowTerminal);
	const nameOf = useNameOf();
	const { id, archived } = conversation;
	const files = useHandedOutBy(conversation) === null;
	// The agents it handed tasks to go with it, any at work stopped.
	const along = useHandedTo(conversation).filter((each) => !each.archived);
	const put = () =>
		void archiveConversation(id, !archived).then(
			() => after.current?.(),
			(error: unknown) =>
				refuse(archived ? "Not unarchived" : "Not archived", error),
		);
	const working =
		conversation.status === "starting" || conversation.status === "running";
	// Otherwise only its shell can lose anything, like a dev server it runs;
	// asked as it is clicked, since the shell comes and goes without a render here.
	const file = (then?: () => void) => {
		after.current = then;
		if (!files) {
			return;
		}
		if (!archived && (working || along.length > 0 || shellRunning(id))) {
			setAsking(true);
		} else {
			put();
		}
	};
	const confirm = (
		<Dialog open={asking} onOpenChange={setAsking}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Archive {nameOf(conversation)}?</DialogTitle>
					<DialogDescription>
						{working
							? "The agent is still running. Archiving stops it and closes its terminal."
							: along.length > 0
								? "Archiving stops its agent."
								: conversation.status === "idle"
									? "Its terminal is still open. Archiving closes it, and stops the idle agent."
									: "Its terminal is still open. Archiving closes it."}
					</DialogDescription>
					{along.length > 0 && (
						<DialogDescription>
							It takes the agents it handed tasks to with it, stopping any at
							work, and unarchiving it brings them back:{" "}
							{along
								.map(
									(each) =>
										`${nameOf(each)}${each.status === "running" || each.status === "starting" ? " (working)" : ""}`,
								)
								.join(", ")}
							.
						</DialogDescription>
					)}
				</DialogHeader>
				<DialogFooter>
					{/* Only its shell stands in the way: show it, to stop what runs
					    there or see that nothing does. */}
					{!working && along.length === 0 && showTerminal !== null && (
						<Button
							variant="outline"
							className="sm:mr-auto"
							onClick={() => {
								setAsking(false);
								showTerminal(id);
							}}
						>
							<SquareTerminalIcon />
							Show the terminal
						</Button>
					)}
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						variant="destructive"
						onClick={() => {
							setAsking(false);
							put();
						}}
					>
						Archive
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
	return { file, confirm, files };
}

/**
 * A box in place of a conversation's name: Enter keeps what is typed (blank
 * goes back to the agent's title), and Escape or leaving it keeps the old.
 */
export function Rename({
	conversation,
	refuse,
	onDone,
}: {
	conversation: ConversationState;
	refuse: Refuse;
	onDone: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	// "Not started" is no name to edit from.
	const [value, setValue] = useState(
		unnamed(conversation)
			? (openingOf(conversation) ?? "")
			: nameOf(conversation),
	);
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => {
		// After the menu that asked for it hands focus back to its trigger.
		const later = setTimeout(() => box.current?.select());
		return () => clearTimeout(later);
	}, []);
	return (
		<input
			ref={box}
			aria-label={`Rename ${nameOf(conversation)}`}
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={onDone}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					renameConversation(conversation.id, value)
						.catch((error: unknown) => refuse("Not renamed", error))
						.finally(onDone);
				} else if (event.key === "Escape") {
					event.preventDefault();
					onDone();
				}
			}}
			className="mx-1 h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/**
 * Where a conversation runs, for a list not grouped by task: nothing when its
 * name already says so, as a finished task's name does.
 */
export function whereOf(
	conversation: ConversationState,
	trunk: string | null,
): string | null {
	if (namedForTask(conversation)) {
		return null;
	}
	return whereRuns(conversation.task, trunk);
}
