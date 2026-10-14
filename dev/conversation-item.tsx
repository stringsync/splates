import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	CheckIcon,
	CircleDotIcon,
	EllipsisVerticalIcon,
	LinkIcon,
	PencilIcon,
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
import type { ConversationState } from "../conversations";
import type { Need } from "../needs";
import { AgentIcon } from "./agent-icons";
import { copiedLabel, useCopy } from "./card";
import {
	archiveConversation,
	markUnread,
	renameConversation,
} from "./conversation-api";
import {
	openingOf,
	reportedAs,
	unnamed,
	useNameOf,
} from "./conversation-names";
import { Trunk, whereRuns } from "./dispatching";
import { Mark } from "./mark";
import { Refusal, type Refuse, useRefusal } from "./refusal";
import { ShellRunning } from "./terminal";

/**
 * One conversation in a list: its agent's mark, its name, and whether it
 * needs you. Hovered or focused, it offers Archive (or Unarchive) and a menu.
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
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const nameOf = useNameOf();
	const [renaming, setRenaming] = useState(false);
	const { copied, copy } = useCopy();
	const trunk = useContext(Trunk);
	const { id, archived } = conversation;
	const { refusal, refuse } = useRefusal();
	const { file, confirm } = useArchive(conversation, refuse);
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
				onDoubleClick={() => setRenaming(true)}
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
								reported === null &&
								!conversation.unread &&
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
						unnamed(conversation) && "text-muted-foreground italic",
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
					<Mark need={need} reported={reported} unread={conversation.unread} />
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
						<DropdownMenuItem onClick={() => setRenaming(true)}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
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
						<DropdownMenuItem
							onClick={() => file(archived ? undefined : onLeft)}
						>
							<Put />
							{put}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`${put} ${nameOf(conversation)}`}
					onClick={() => file(archived ? undefined : onLeft)}
				>
					<Put />
				</Button>
			</span>
			<Refusal refusal={refusal} className="w-full px-3 pb-1.5" />
		</div>
	);
}

/**
 * Archives `conversation`, or brings it back, then runs `then`. While its
 * agent works, or sits idle with its shell up, `file` asks first in
 * `confirm`, since archiving stops both; render `confirm` beside whatever
 * calls `file`.
 */
export function useArchive(
	conversation: ConversationState,
	refuse: Refuse,
): {
	file: (then?: () => void) => void;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState(false);
	// Held while `confirm` asks.
	const after = useRef<(() => void) | undefined>(undefined);
	const shellRunning = useContext(ShellRunning);
	const nameOf = useNameOf();
	const { id, archived } = conversation;
	const put = () =>
		void archiveConversation(id, !archived).then(
			() => after.current?.(),
			(error: unknown) =>
				refuse(archived ? "Not unarchived" : "Not archived", error),
		);
	const working =
		conversation.status === "starting" || conversation.status === "running";
	// Idle, only its shell can lose anything, like a dev server it runs; asked
	// as it is clicked, since the shell comes and goes without a render here.
	const file = (then?: () => void) => {
		after.current = then;
		if (
			!archived &&
			(working || (conversation.status === "idle" && shellRunning(id)))
		) {
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
							: "Its terminal is still open. Archiving closes it, and stops the idle agent."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
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
	return { file, confirm };
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
	if (
		conversation.lastTask !== null &&
		(conversation.name ?? conversation.lastTask) === conversation.lastTask
	) {
		return null;
	}
	return whereRuns(conversation.task, trunk);
}
