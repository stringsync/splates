import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArchiveIcon, CircleDotIcon, PencilIcon } from "lucide-react";
import {
	type JSX,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { cn } from "#dev/lib/utils.ts";
import { openingOf } from "../conversation-name";
import type { ConversationState } from "../conversations";
import { markUnread, renameConversation } from "./conversation-api";
import { useArchive } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import { useHandedOutBy } from "./handed-out";
import { Swipeable } from "./phone-swipe";
import type { Refuse } from "./refusal";

/** How long a finger rests on a row before its menu opens. */
const HOLD_MS = 500;

/** How far a finger may drift while held, in pixels, before it scrolls. */
const DRIFT_PX = 10;

/**
 * Opens a row's menu on a long press, or a right-click, and swallows the tap
 * that ends the press, so the row does not open too. A finger that moves
 * scrolls instead.
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
 * A conversation's row, held down for its menu or swiped left to archive it,
 * which asks first, as the menu's Archive does, when it would stop or close
 * anything.
 */
export function Filed({
	conversation,
	refuse,
	children,
}: {
	conversation: ConversationState;
	refuse: Refuse;
	/** The row, given what opens its menu on a long press. */
	children: (press: ReturnType<typeof useLongPress>) => ReactNode;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const press = useLongPress(() => setMenu(true));
	const { file, asks, confirm, files } = useArchive(conversation, refuse);
	const archivable = files && !conversation.archived;
	return (
		<>
			{confirm}
			<RowMenu
				conversation={conversation}
				open={menu}
				onOpenChange={setMenu}
				archive={archivable ? () => file() : null}
				refuse={refuse}
			/>
			<Swipeable archive={archivable ? { asks, file } : null}>
				{children(press)}
			</Swipeable>
		</>
	);
}

/**
 * A row's menu as a sheet up from the bottom, as iOS's apps offer one on a
 * long press: its name, then Rename, Mark as unread and Archive, each a
 * finger's height. Rename turns the name into a box to type in.
 */
function RowMenu({
	conversation,
	open,
	onOpenChange,
	archive,
	refuse,
}: {
	conversation: ConversationState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Files it away, asking first as its row does; null when it cannot be. */
	archive: (() => void) | null;
	refuse: Refuse;
}): JSX.Element {
	const nameOf = useNameOf();
	const [renaming, setRenaming] = useState(false);
	const [value, setValue] = useState("");
	const box = useRef<HTMLInputElement>(null);
	const handedOut = useHandedOutBy(conversation) !== null;
	const { id, archived } = conversation;
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
		void renameConversation(id, value).catch((error: unknown) =>
			refuse("Not renamed", error),
		);
		close();
	};
	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(open) => (open ? onOpenChange(true) : close())}
		>
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
							renaming && "sr-only",
						)}
					>
						{nameOf(conversation)}
					</DialogPrimitive.Title>
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
							{!handedOut && (
								<Action icon={<PencilIcon />} onClick={rename}>
									Rename
								</Action>
							)}
							{!conversation.unread && !archived && (
								<Action
									icon={<CircleDotIcon />}
									onClick={() => {
										close();
										void markUnread(id, true).catch((error: unknown) =>
											refuse("Not marked unread", error),
										);
									}}
								>
									Mark as unread
								</Action>
							)}
							{archive !== null && (
								<Action
									icon={<ArchiveIcon />}
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
					<DialogPrimitive.Close className="mt-1 h-12 rounded-xl bg-muted font-medium text-base active:opacity-80">
						Cancel
					</DialogPrimitive.Close>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** One of the sheet's actions, a finger's height. */
function Action({
	icon,
	onClick,
	children,
}: {
	icon: ReactNode;
	onClick: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-12 items-center gap-3 rounded-xl px-3 text-left text-base active:bg-muted [&_svg]:size-5 [&_svg]:text-muted-foreground"
		>
			{icon}
			{children}
		</button>
	);
}
