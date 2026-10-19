import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	namedForTask,
	openingOf,
} from "@stringsync/splates-server/conversations/browser";
import type { Need } from "@stringsync/splates-server/plans";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	CheckIcon,
	CircleDotIcon,
	EllipsisVerticalIcon,
	LinkIcon,
	ListTreeIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	SquareIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationTag, RowIcon } from "./agent-icons";
import { AutoIcon } from "./auto-brand";
import { copiedLabel, useCopy } from "./card";
import {
	markUnread,
	pinConversation,
	renameConversation,
} from "./conversation-api";
import { filable, useArchive } from "./conversation-archive";
import { reportedAs, unnamed, useNameOf } from "./conversation-names";
import { placeholding } from "./conversation-rows";
import { Trunk, whereRuns } from "./dispatching";
import { useExpect } from "./expecting";
import { Mark } from "./mark";
import { stopTurn, useQuiet } from "./quiet";
import { Refusal, type Refuse } from "./refusal";
import { MoveUnder, usePlaces } from "./reparent";
import { useRowRefusal } from "./row-refusal";

/**
 * One conversation in a list: its agent's mark, its name, and whether it
 * needs you, its name muted for one that answers to another, and a pin while
 * pinned. Hovered or focused, it offers a menu, Move under… among it, Archive
 * (or Unarchive), Stop turn while its agent may be stuck, and Pin (or Unpin),
 * but for one nested under another, which moves with that one.
 */
export function Item({
	conversation,
	agent,
	need,
	current,
	onOpen,
	onLeft,
	where = false,
	ago = null,
	project = null,
	hint = null,
	hosting = false,
	nested = false,
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
	/** How long ago it was archived, as `3h ago`, said after where it ran. */
	ago?: string | null;
	/** The project it is in, said after its name, as Needs you names each. */
	project?: string | null;
	/** The key that opens it with ⌥⌘, while ⌥⌘ is held. */
	hint?: string | null;
	/** Whether an agent it handed a task to is at work. */
	hosting?: boolean;
	/** Whether it sits under another row, as a part does under its host. */
	nested?: boolean;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const nameOf = useNameOf();
	const [renaming, setRenaming] = useState(false);
	const [moving, setMoving] = useState(false);
	const places = usePlaces(conversation);
	const { copied, copy } = useCopy();
	const trunk = useContext(Trunk);
	const { id, archived } = conversation;
	const { refusal, refuse } = useRowRefusal(id);
	const expect = useExpect();
	const { file, confirm } = useArchive(conversation, refuse);
	const reported = reportedAs(conversation);
	const quiet = useQuiet(conversation);
	const Put = archived ? ArchiveRestoreIcon : ArchiveIcon;
	const put = archived ? "Unarchive" : "Archive";
	const pins = !archived && !nested;
	const pinned = pins && conversation.pinned;
	const Pin = pinned ? PinOffIcon : PinIcon;
	const pin = pinned ? "Unpin" : "Pin";
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
			{places !== null && (
				<MoveUnder
					conversation={conversation}
					places={places}
					open={moving}
					onOpenChange={setMoving}
					refuse={refuse}
				/>
			)}
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
					"flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left group-focus-within/item:pr-20 group-hover/item:pr-20 pointer-coarse:pr-28",
					renaming && "hidden",
					placeholding(conversation) && "opacity-50",
					menu
						? "pr-20"
						: need.kind === "idle" &&
								!hosting &&
								reported === null &&
								!conversation.unread &&
								hint === null
							? "pr-3"
							: "pr-6",
				)}
			>
				{conversation.picking ? (
					<AutoIcon className="size-3.5 shrink-0" />
				) : (
					<RowIcon
						conversation={conversation}
						name={agent}
						className="size-3.5 text-foreground/70"
					/>
				)}
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					<span
						className={cn(
							"min-w-0 truncate text-sm",
							(unnamed(conversation) || placeholding(conversation)) &&
								"text-muted-foreground italic",
						)}
					>
						{nameOf(conversation)}
					</span>
					<AutomationTag conversation={conversation} />
				</span>
				{pinned && (
					<PinIcon
						aria-label="Pinned"
						// Gone while its buttons show, Unpin among them.
						className={cn(
							"size-3 shrink-0 text-muted-foreground group-focus-within/item:hidden group-hover/item:hidden pointer-coarse:hidden",
							menu && "hidden",
						)}
					/>
				)}
				{where && whereOf(conversation, trunk) !== null && (
					<span className="shrink-0 truncate text-muted-foreground text-xs">
						{whereOf(conversation, trunk)}
					</span>
				)}
				{ago !== null && (
					<span className="shrink-0 text-muted-foreground text-xs">{ago}</span>
				)}
				{project !== null && (
					<span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
						{project}
					</span>
				)}
			</button>
			<span
				className={cn(
					"pointer-events-none absolute right-2 flex items-center pointer-coarse:right-22",
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
						starting={conversation.status === "starting"}
						picking={conversation.picking}
						need={need}
						reported={reported}
						unread={conversation.unread}
						hosting={hosting}
						quiet={quiet}
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
						<DropdownMenuItem onClick={() => setRenaming(true)}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
						{/* The one open would be read again at once. */}
						{!current && !conversation.unread && !archived && (
							<DropdownMenuItem
								onClick={() =>
									void expect(id, { unread: true }, markUnread(id, true)).catch(
										(error: unknown) => refuse("Not marked unread", error),
									)
								}
							>
								<CircleDotIcon />
								Mark as unread
							</DropdownMenuItem>
						)}
						{places !== null && !archived && (
							<DropdownMenuItem onClick={() => setMoving(true)}>
								<ListTreeIcon />
								Move under…
							</DropdownMenuItem>
						)}
						{quiet !== null && (
							<DropdownMenuItem
								onClick={() => stopTurn(conversation, expect, refuse)}
							>
								<SquareIcon />
								Stop turn
							</DropdownMenuItem>
						)}
						{filable(conversation) && (
							<DropdownMenuItem
								onClick={() => file(archived ? undefined : onLeft)}
							>
								<Put />
								{put}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				{pins && (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`${pin} ${nameOf(conversation)}`}
						onClick={() =>
							void expect(
								id,
								{ pinned: !pinned },
								pinConversation(id, !pinned),
							).catch((error: unknown) =>
								refuse(pinned ? "Not unpinned" : "Not pinned", error),
							)
						}
					>
						<Pin />
					</Button>
				)}
				{filable(conversation) && (
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
	const expect = useExpect();
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
					onDone();
					void expect(
						conversation.id,
						{ name: nameIn(value) },
						renameConversation(conversation.id, value),
					).catch((error: unknown) => refuse("Not renamed", error));
				} else if (event.key === "Escape") {
					event.preventDefault();
					onDone();
				}
			}}
			className="mx-1 h-7 pointer-coarse:h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm pointer-coarse:text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/** The name renaming a conversation to `typed` gives it, as the server keeps it. */
export function nameIn(typed: string): string | null {
	return typed.trim() || null;
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
