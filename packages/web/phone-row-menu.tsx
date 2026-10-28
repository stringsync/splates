import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { openingOf } from "@stringsync/splates-server/conversations/browser";
import {
	ArchiveIcon,
	CircleDotIcon,
	EllipsisIcon,
	ListTreeIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	SquareIcon,
} from "lucide-react";
import {
	type JSX,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import {
	markUnread,
	pinConversation,
	renameConversation,
} from "./conversation-api";
import { useArchive } from "./conversation-archive";
import { nameIn } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import { useConversationProject } from "./conversation-project";
import { useExpect, usePendingConversation } from "./expecting";
import { pendingRow, useShowPending } from "./pending";
import { stopTurn, useQuiet } from "./quiet";
import type { Refuse } from "./refusal";
import { MoveUnder, usePlaces } from "./reparent";

/** How long a finger rests on a row before its menu opens. */
const HOLD_MS = 500;

/** How far a finger may drift while held, in pixels, before it scrolls. */
const DRIFT_PX = 10;

/**
 * What opens a row's menu on a long press or a right-click, without opening
 * the row too. A finger that moves scrolls instead.
 */
export function useLongPress(onPress: () => void): {
	onPointerDown: (event: PointerEvent) => void;
	onPointerMove: (event: PointerEvent) => void;
	onPointerUp: () => void;
	onPointerCancel: () => void;
	onContextMenu: (event: { preventDefault: () => void }) => void;
	onClickCapture: (event: {
		preventDefault: () => void;
		stopPropagation: () => void;
	}) => void;
} {
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const start = useRef<{ x: number; y: number } | null>(null);
	const pressed = useRef(false);
	useEffect(() => () => clearTimeout(timer.current), []);
	const stop = () => {
		clearTimeout(timer.current);
		start.current = null;
	};
	const press = () => {
		stop();
		pressed.current = true;
		onPress();
	};
	return {
		onPointerDown: (event) => {
			pressed.current = false;
			start.current = { x: event.clientX, y: event.clientY };
			timer.current = setTimeout(press, HOLD_MS);
		},
		onPointerMove: (event) => {
			if (
				start.current !== null &&
				Math.hypot(
					event.clientX - start.current.x,
					event.clientY - start.current.y,
				) > DRIFT_PX
			) {
				stop();
			}
		},
		onPointerUp: stop,
		onPointerCancel: stop,
		// Android's long press and a mouse's right button.
		onContextMenu: (event) => {
			event.preventDefault();
			if (!pressed.current) {
				press();
			}
		},
		onClickCapture: (event) => {
			if (pressed.current) {
				pressed.current = false;
				event.preventDefault();
				event.stopPropagation();
			}
		},
	};
}

/**
 * A conversation's row with a visible button for its action sheet. A long
 * press opens the same sheet; Archive asks before stopping or closing anything.
 */
export function Filed({
	conversation,
	refuse,
	nested,
	children,
}: {
	conversation: ConversationState;
	refuse: Refuse;
	/** Whether it sits under another row, so moves with it and is never pinned. */
	nested: boolean;
	/** The row, given what opens its menu on a long press. */
	children: (press: ReturnType<typeof useLongPress>) => ReactNode;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const press = useLongPress(() => setMenu(true));
	const { file, confirm } = useArchive(conversation, refuse);
	// Held still while a write to it is on its way, so none repeats.
	const pending = usePendingConversation(conversation.id);
	const showPending = useShowPending(pending);
	const archivable = !conversation.archived && !pending;
	const nameOf = useNameOf();
	return (
		<>
			{confirm}
			<RowMenu
				conversation={conversation}
				open={menu}
				onOpenChange={setMenu}
				archive={archivable ? () => file() : null}
				pins={archivable && !nested}
				refuse={refuse}
			/>
			<div {...pendingRow(pending, showPending, "flex items-center pr-2")}>
				{children(press)}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-11"
					aria-label="Conversation actions"
					aria-description={nameOf(conversation)}
					aria-haspopup="dialog"
					aria-expanded={menu}
					disabled={pending}
					onClick={() => setMenu(true)}
				>
					<EllipsisIcon />
				</Button>
			</div>
		</>
	);
}

/**
 * A row's menu as a sheet up from the bottom, as iOS's apps offer one on a
 * long press: its name, then Rename, Mark as unread, Move under…, Pin, Stop
 * turn and Archive, each a finger's height, Pin only when `pins` and Stop turn
 * only while its agent may be stuck. Rename turns the
 * name into a box to type in; Move under… asks where in a dialog.
 */
function RowMenu({
	conversation,
	open,
	onOpenChange,
	archive,
	pins,
	refuse,
}: {
	conversation: ConversationState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Files it away, asking first as its row does; null when it cannot be. */
	archive: (() => void) | null;
	pins: boolean;
	refuse: Refuse;
}): JSX.Element {
	const nameOf = useNameOf();
	const [renaming, setRenaming] = useState(false);
	const [value, setValue] = useState("");
	const box = useRef<HTMLInputElement>(null);
	const places = usePlaces(conversation);
	const [moving, setMoving] = useState(false);
	const expect = useExpect();
	const quiet = useQuiet(conversation);
	const { id, archived } = conversation;
	const project = useConversationProject()?.project;
	const pending = usePendingConversation(id);
	const close = () => {
		onOpenChange(false);
		setRenaming(false);
	};
	const rename = () => {
		// Focused within the tap, as iOS raises its keyboard only then.
		flushSync(() => {
			setValue(
				unnamed(conversation)
					? (openingOf(conversation) ?? "")
					: nameOf(conversation),
			);
			setRenaming(true);
		});
		box.current?.select();
	};
	const save = () => {
		void expect(
			id,
			{ name: nameIn(value) },
			renameConversation(id, value, project),
		).catch((error: unknown) => refuse("Not renamed", error));
		close();
	};
	return (
		<>
			{places !== null && (
				<MoveUnder
					conversation={conversation}
					places={places}
					open={moving}
					onOpenChange={setMoving}
					refuse={refuse}
				/>
			)}
			<Sheet
				open={open}
				onOpenChange={(open) => (open ? onOpenChange(true) : close())}
				title={nameOf(conversation)}
				titleHidden={renaming}
			>
				{renaming ? (
					<form
						className="flex items-center gap-2 px-1 pb-1"
						onSubmit={(event) => {
							event.preventDefault();
							save();
						}}
					>
						<input
							ref={box}
							aria-label={`Rename ${nameOf(conversation)}`}
							value={value}
							onChange={(event) => setValue(event.target.value)}
							enterKeyHint="done"
							className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<button
							type="submit"
							className="h-11 shrink-0 rounded-lg bg-primary px-4 font-medium text-base text-primary-foreground active:opacity-80"
						>
							Save
						</button>
					</form>
				) : (
					<>
						<Action icon={<PencilIcon />} onClick={rename}>
							Rename
						</Action>
						{!conversation.unread && !archived && (
							<Action
								icon={<CircleDotIcon />}
								disabled={pending}
								onClick={() => {
									close();
									void expect(
										id,
										{ unread: true },
										markUnread(id, true, project),
									).catch((error: unknown) =>
										refuse("Not marked unread", error),
									);
								}}
							>
								Mark as unread
							</Action>
						)}
						{places !== null && !archived && (
							<Action
								icon={<ListTreeIcon />}
								onClick={() => {
									close();
									setMoving(true);
								}}
							>
								Move under…
							</Action>
						)}
						{pins && (
							<Action
								icon={conversation.pinned ? <PinOffIcon /> : <PinIcon />}
								disabled={pending}
								onClick={() => {
									close();
									void expect(
										id,
										{ pinned: !conversation.pinned },
										pinConversation(id, !conversation.pinned, project),
									).catch((error: unknown) =>
										refuse(
											conversation.pinned ? "Not unpinned" : "Not pinned",
											error,
										),
									);
								}}
							>
								{conversation.pinned ? "Unpin" : "Pin"}
							</Action>
						)}
						{quiet !== null && (
							<Action
								icon={<SquareIcon />}
								disabled={pending}
								onClick={() => {
									close();
									stopTurn(conversation, expect, refuse, project);
								}}
							>
								Stop turn
							</Action>
						)}
						{archive !== null && (
							<Action
								icon={<ArchiveIcon />}
								disabled={pending}
								onClick={() => {
									close();
									archive();
								}}
							>
								Archive
							</Action>
						)}
					</>
				)}
			</Sheet>
		</>
	);
}

/**
 * A sheet up from the bottom, as iOS's apps offer one on a long press: its
 * title, hidden but still read out when `titleHidden`, its actions, then
 * Cancel.
 */
export function Sheet({
	open,
	onOpenChange,
	title,
	titleHidden = false,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	titleHidden?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-1 rounded-t-2xl bg-popover px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full">
					<span
						aria-hidden
						className="mx-auto mb-1 h-1 w-10 rounded-full bg-muted-foreground/30"
					/>
					<DialogPrimitive.Title
						className={cn(
							"truncate px-3 pb-1 text-center text-muted-foreground text-sm",
							titleHidden && "sr-only",
						)}
					>
						{title}
					</DialogPrimitive.Title>
					{children}
					<DialogPrimitive.Close className="mt-1 h-12 rounded-xl bg-muted font-medium text-base active:opacity-80">
						Cancel
					</DialogPrimitive.Close>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** One of the sheet's actions, a finger's height. */
export function Action({
	icon,
	onClick,
	disabled = false,
	children,
}: {
	icon: ReactNode;
	onClick: () => void;
	/** Out of reach while a write it made is pending. */
	disabled?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="flex h-12 items-center gap-3 rounded-xl px-3 text-left text-base active:bg-muted disabled:opacity-50 [&_svg]:size-5 [&_svg]:text-muted-foreground"
		>
			{icon}
			{children}
		</button>
	);
}
