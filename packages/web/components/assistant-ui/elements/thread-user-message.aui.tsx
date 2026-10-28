"use client";

import {
	ActionBarPrimitive,
	AuiIf,
	type CompleteAttachment,
	MessagePrimitive,
	type TextMessagePartComponent,
	useAuiState,
} from "@assistant-ui/react";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import {
	APPROVE,
	leadingDirectives,
	MERGE,
} from "@stringsync/splates-server/plans/browser";
import {
	CheckIcon,
	CopyIcon,
	CornerDownRightIcon,
	MicIcon,
} from "lucide-react";
import {
	type FC,
	type PropsWithChildren,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { linkAttachments } from "#web/attachment-chips.tsx";
import { Board } from "#web/board.ts";
import { repliesToProposal, repliesToReview } from "#web/card-reply.tsx";
import { MarkdownText } from "#web/components/assistant-ui/elements/markdown-text.tsx";
import { useAnchorAtOnce } from "#web/components/assistant-ui/elements/thread-scroll.aui.ts";
import { TooltipIconButton } from "#web/components/assistant-ui/elements/tooltip-icon-button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
} from "#web/components/ui/dropdown-menu.tsx";
import { SEEN } from "#web/conversation-feed.ts";
import { useNameOf } from "#web/conversation-names.ts";
import {
	DirectiveChip,
	DirectiveLine,
	isBare,
	isSoleCommand,
	linkDirectives,
	soleDirective,
	unshown,
} from "#web/directives.tsx";
import { useHeldConversations } from "#web/handed-out.tsx";
import { cn } from "#web/lib/utils.ts";
import { useShowPending } from "#web/pending.tsx";
import { useLongPress } from "#web/phone-row-menu.tsx";
import {
	type Sent,
	SentAttachmentChip,
	SentAttachments,
	unnamed,
} from "#web/sent-attachments.tsx";
import { handOffLines, serverToldLines } from "#web/server-messages.ts";
import { SplatesEvent } from "#web/splates-event.tsx";
import { Stamp, useStamps } from "#web/stamp.tsx";
import { SendingLine, UnsentLine } from "#web/unsent.tsx";

/**
 * Has a person's message report, as its `offsetTop`, where it sits before it
 * sticks: its turn's box, which it opens. Stuck, the browser's reading follows
 * the scroll instead, and assistant-ui (like `useAnchorAtOnce`) sizes its
 * spacer from it, so each time it measured a stuck message the spacer grew
 * by however far the thread had scrolled, letting the reply scroll behind
 * the message with nothing more below it.
 */
const unstuckTop = (element: HTMLDivElement | null) => {
	const turn = element?.parentElement;
	if (element == null || turn == null || turn.firstElementChild !== element) {
		return;
	}
	Object.defineProperty(element, "offsetTop", {
		configurable: true,
		get: () => turn.offsetTop,
	});
	return () => {
		Reflect.deleteProperty(element, "offsetTop");
	};
};
/**
 * What the person typed, as markdown with each line break kept, each todo it
 * mentions a link to it, each system and file a chip, and the directives and
 * attachments after those `Leading` shows as chips where they stand.
 */
const UserText: TextMessagePartComponent = ({ text }) => {
	const { rest } = leadingDirectives(text);
	return rest === "" ? null : <MarkdownText typed={afterDirectives} />;
};
/**
 * The chips a message starts with, in a row above its words as the composer
 * showed them: the directives its words start with, and each attachment its
 * words never name.
 */
const Leading: FC<{ text: string; sent: readonly Sent[] }> = ({
	text,
	sent,
}) => {
	const { directives, rest } = leadingDirectives(text);
	const loose = unnamed(sent, text);
	if (directives.length + loose.length === 0) {
		return null;
	}
	return (
		<span
			data-slot="aui_user-message-directives"
			className={cn(
				"aui-user-message-directives flex flex-wrap gap-2",
				rest !== "" && "pb-2",
			)}
		>
			{directives.map((directive) => (
				<DirectiveChip key={directive} directive={directive} opens />
			))}
			{loose.map((placed) => (
				<SentAttachmentChip
					key={`${placed.shelf} ${placed.at}`}
					placed={placed}
				/>
			))}
		</span>
	);
};
/**
 * A message's text past the directives `UserText` shows in a row, each
 * directive after them a link the markdown draws as its chip.
 */
const afterDirectives = (text: string) =>
	linkAttachments(linkDirectives(leadingDirectives(text).rest));
export const UserMessage: FC = () => {
	const id = useAuiState((s) => s.message.id);
	const attachments = useAuiState((s) => s.message.attachments);
	const steered = useAuiState(
		(s) => s.message.metadata.custom.steered === true,
	);
	const stamps = useStamps();
	const board = useContext(Board);
	const stamped = useAuiState((s) => {
		const at = s.message.metadata.custom.at;
		return typeof at === "string" ? at : null;
	});
	const at = stamps.shown ? stamped : null;
	const told = useAuiState((s) => {
		const from = s.message.metadata.custom.told;
		return typeof from === "string" ? from : null;
	});
	const teller = useHeldConversations().find((each) => each.id === told);
	const dictated = useAuiState(
		(s) => s.message.metadata.custom.dictated === true,
	);
	const unsent = useAuiState((s) => {
		const at = s.message.metadata.custom.unsent;
		return typeof at === "number" ? at : null;
	});
	const sending = useAuiState((s) => s.message.metadata.custom.sending);
	// On its way until the server's own copy, under the same id, takes its place.
	const pending = useAuiState(
		(s) => s.message.metadata.custom.pending === true,
	);
	const nameOf = useNameOf();
	const sole = useAuiState((s) => {
		const [only, ...more] = s.message.parts;
		return only?.type === "text" && more.length === 0
			? soleDirective(only.text)
			: null;
	});
	const text = useAuiState((s) =>
		s.message.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n"),
	);
	// A review's Merge or a proposal's Approve, which the card's own line
	// says was approved.
	const approved = useAuiState(
		(s) =>
			(sole === MERGE && repliesToReview(s.thread.messages, s.message.index)) ||
			(sole === APPROVE &&
				repliesToProposal(s.thread.messages, s.message.index)),
	);
	const sent = sentOf(attachments);
	const lines =
		sent.length === 0 && sole === null
			? told === SERVER_TOLD
				? serverToldLines(text, board, at)
				: handOffLines(text, at)
			: null;
	if (lines !== null) {
		// What the agent heard, said as splates's lines, which carry on the
		// turn it comes in (see `carriesOn`) as a bare directive's does.
		return (
			<div
				data-slot="aui_user-message-root"
				data-message-id={id}
				className="px-2"
				data-role="user"
			>
				{lines.map((line) => (
					<SplatesEvent key={JSON.stringify(line.words)} event={line} />
				))}
			</div>
		);
	}
	if (sole !== null && sent.length === 0 && isBare(sole)) {
		// Not a primitive's root, which assistant-ui would anchor a reply's
		// turn to: it carries on the turn it comes in (see `carriesOn`).
		return (
			<div
				data-slot="aui_user-message-root"
				data-message-id={id}
				className={approved ? undefined : "px-2"}
				data-role="user"
			>
				{!approved && <DirectiveLine directive={sole} at={at} />}
			</div>
		);
	}
	if (sole !== null && sent.length === 0 && unshown(sole)) {
		// Nothing to see, but still where its turn starts.
		return (
			<MessagePrimitive.Root
				data-slot="aui_user-message-root"
				data-message-id={id}
				data-role="user"
			/>
		);
	}
	if (sole !== null && sent.length === 0) {
		// A card, with nothing to stick atop its turn: what it asked is said once.
		return (
			<MessagePrimitive.Root
				data-slot="aui_user-message-root"
				data-message-id={id}
				className="px-2"
				data-role="user"
			>
				<DirectiveLine directive={sole} at={at} />
			</MessagePrimitive.Root>
		);
	}
	const body = (
		<>
			<Bubble pending={pending}>
				<Clamped watch={id} dictated={dictated}>
					{/* Only words: the files it carries are attachments, shown as
				their chips. */}
					<SentAttachments value={sent}>
						<Leading text={text} sent={sent} />
						<MessagePrimitive.Parts components={{ Text: UserText }} />
					</SentAttachments>
				</Clamped>
			</Bubble>
			{(steered || at !== null || told !== null) && (
				<div className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs">
					{at !== null && <Stamp at={at} />}
					{at !== null && told !== null && <span aria-hidden>·</span>}
					{told !== null && (
						<span data-slot="aui_user-message-told">
							from{" "}
							{told === SERVER_TOLD ? (
								"splates server"
							) : teller === undefined ? (
								"another conversation"
							) : (
								<a
									href={`#conversations/${teller.id}`}
									className="underline-offset-2 hover:underline focus-visible:underline"
								>
									{nameOf(teller)}
								</a>
							)}
						</span>
					)}
					{(at !== null || told !== null) && steered && (
						<span aria-hidden>·</span>
					)}
					{steered && (
						<span
							data-slot="aui_user-message-steered"
							className="flex items-center gap-1"
						>
							<CornerDownRightIcon className="size-3" aria-hidden />
							Steered into the running turn
						</span>
					)}
				</div>
			)}
			{pending && (
				<SendingLine seconds={typeof sending === "number" ? sending : null} />
			)}
			{unsent !== null && <UnsentLine at={unsent} />}
		</>
	);
	if (sent.length === 0 && isSoleCommand(text)) {
		// A skill or command alone, which carries on the turn it comes in (see
		// `carriesOn`): not a primitive's root, which assistant-ui would anchor
		// a reply's turn to, nor stuck atop the thread.
		return (
			<div
				data-slot="aui_user-message-root"
				data-message-id={id}
				className="mb-2 flex flex-col gap-y-2 px-2 max-sm:items-end"
				data-role="user"
			>
				{body}
			</div>
		);
	}
	return (
		<MessagePrimitive.Root
			ref={unstuckTop}
			data-slot="aui_user-message-root"
			// What `useAnchorAtOnce` finds a new turn's start by.
			data-message-id={id}
			className={cn(
				// No entrance: the thread jumps to it as it comes, with nothing
				// else in view, so a fade would show an empty thread for a frame.
				"flex flex-col gap-y-2 px-2 max-sm:items-end",
				// Stuck atop the thread for as long as its turn is in view. Opaque,
				// so the reply cannot show past its rounded corners, then fading
				// the reply out over the 2rem below it, which its turn keeps clear
				// while it is not stuck (`data-sticks`). The margin alone is what
				// its turn holds it by, so the fade comes to the next message's
				// top as that pushes it out. A phone's thread (narrower than
				// `WIDE`) scrolls it away with the rest, keeping its short screen
				// for the reply.
				"bg-background md:sticky top-0 z-10 mb-2 [container-type:scroll-state]",
				"md:after:pointer-events-none md:after:absolute md:after:inset-x-0 md:after:top-full md:after:h-8 md:after:bg-linear-to-b md:after:from-background md:after:to-transparent",
			)}
			data-role="user"
			data-sticks
		>
			{body}
		</MessagePrimitive.Root>
	);
};
/**
 * The files a message holds, where the page loads each from. An image kept as
 * a file, for an agent that sees no images, still counts as an image, as the
 * composer named it.
 */
const sentOf = (
	attachments: readonly CompleteAttachment[] | undefined = [],
): Sent[] =>
	attachments.flatMap((attachment) =>
		(attachment.content ?? []).flatMap((part) =>
			part.type === "image" || part.type === "file"
				? [
						{
							src: part.type === "image" ? part.image : part.data,
							name: attachment.name,
							type: SEEN.includes(attachment.contentType ?? "")
								? "image"
								: attachment.type,
							contentType: attachment.contentType,
						},
					]
				: [],
		),
	);
/** How long after a hold's finger lifts its click may still come. */
const LIFT_MS = 400;
/**
 * The box of what the person said, with its copy button. On a phone, a
 * bubble at the thread's end, with no copy button: a finger held on it opens
 * a menu below it to copy from, as Claude's app does, the bubble raised
 * while it is open.
 */
const Bubble: FC<PropsWithChildren<{ pending: boolean }>> = ({
	children,
	pending,
}) => {
	const showPending = useShowPending(pending);
	const box = useRef<HTMLDivElement>(null);
	const [held, setHeld] = useState(false);
	const press = useLongPress(() => setHeld(true));
	// A finger's, as a mouse's right button keeps the browser's own menu.
	const touched = useRef(false);
	// When the finger that opened the menu lifted: the click the browser
	// sends for it lands outside the menu, which would close it at once.
	const lifted = useRef(Number.NEGATIVE_INFINITY);
	const text = useAuiState((s) =>
		s.message.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n"),
	);
	return (
		<>
			<div
				ref={box}
				className={cn(
					"aui-user-message-content-wrapper group/user relative min-w-0 transition-[opacity,transform,scale] duration-200 max-sm:flex max-sm:max-w-[85%] max-sm:flex-col max-sm:items-end max-sm:data-held:scale-[1.03]",
					showPending && "opacity-60",
				)}
				aria-busy={pending}
				data-held={held || undefined}
				onPointerDown={(event) => {
					touched.current = event.pointerType === "touch";
					if (touched.current) {
						press.onPointerDown(event);
					}
				}}
				onPointerMove={press.onPointerMove}
				onPointerUp={() => {
					press.onPointerUp();
					if (held) {
						lifted.current = performance.now();
					}
				}}
				onPointerCancel={press.onPointerCancel}
				onContextMenu={(event) => touched.current && press.onContextMenu(event)}
				onClickCapture={press.onClickCapture}
			>
				{children}
				<UserCopy />
			</div>
			{/* Beside the bubble, not in it: React carries the menu's clicks up
			through its portal, which the bubble would take as its own. */}
			<DropdownMenu
				open={held}
				onOpenChange={(open, { reason }) => {
					if (
						open ||
						reason !== "outside-press" ||
						performance.now() - lifted.current > LIFT_MS
					) {
						setHeld(open);
					}
				}}
			>
				<DropdownMenuContent
					anchor={box}
					align="end"
					sideOffset={8}
					className="w-auto min-w-44"
				>
					{/* Within the tap, as iOS lets the page write the clipboard
					only then. */}
					<DropdownMenuItem
						className="py-2.5 text-base"
						onClick={() => void navigator.clipboard?.writeText(text)}
					>
						<CopyIcon />
						Copy
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
};
/**
 * Copies what the person said, from the message's top corner: there only
 * while the message is hovered or the button has focus, or always under a
 * finger, which cannot hover, and a check once it has copied. Beside the box
 * rather than in it, since the box is itself a button. Not on a phone, where
 * holding the bubble opens a menu to copy from instead.
 */
const UserCopy: FC = () => (
	<ActionBarPrimitive.Copy
		render={
			<TooltipIconButton
				tooltip="Copy"
				className={cn(
					"aui-user-action-copy text-muted-foreground absolute end-(--copy-at) top-(--copy-at) size-6 pointer-coarse:size-10 [--copy-at:0.375rem] pointer-coarse:[--copy-at:0px]",
					"max-sm:hidden",
					"opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100 data-copied:opacity-100 pointer-coarse:opacity-100",
				)}
			/>
		}
	>
		<AuiIf condition={(s) => s.message.isCopied}>
			<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
		</AuiIf>
		<AuiIf condition={(s) => !s.message.isCopied}>
			<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
		</AuiIf>
	</ActionBarPrimitive.Copy>
);
/**
 * What the person said, across the thread's full width like the reply: the
 * theme's muted fill, set apart from the page, with room at its end for the
 * copy button. On a phone, a chat bubble instead: as wide as its words up
 * to most of the thread, at its end, rounded and unbordered, the copy
 * button below it.
 */
const USER_BOX =
	"text-foreground bg-muted rounded-lg border border-foreground/15 ps-4 pe-9 py-2.5 max-sm:rounded-3xl max-sm:border-0 max-sm:pe-4 max-sm:leading-relaxed min-w-0 max-w-full wrap-anywhere";
/**
 * Room at the box's start for the mic a dictated message shows, in the top
 * corner by its first line.
 */
const DICTATED_BOX = "ps-9";
const DICTATED_MIC =
	"text-muted-foreground absolute start-3 top-3.5 size-4 max-sm:top-4 max-sm:size-3.5";
/**
 * Lines of a message shown before it is clicked open: four on a wider
 * screen, where it sticks atop the thread, and twelve in a phone's bubble,
 * which scrolls away with the rest.
 */
const CLAMP = "max-h-24 max-sm:max-h-[12lh]";
/** Where a cut message fades: its last lines. */
const CUT_FADE =
	"[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]";
/**
 * A message cut to four lines (twelve on a phone), fading out where it is cut,
 * and opened or closed again by a click (or Enter) when there is more than
 * fits.
 */
const Clamped: FC<
	PropsWithChildren<{
		/** Changes when the words do, to measure them again. */
		watch: string;
		/** Whether the person said it into the mic, which a mic in its corner shows. */
		dictated: boolean;
	}>
> = ({ watch, dictated, children }) => {
	const text = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [more, setMore] = useState(false);
	useLayoutEffect(() => {
		const box = text.current;
		if (box === null) {
			return;
		}
		const measure = () => setMore(box.scrollHeight > box.clientHeight + 1);
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(box);
		return () => watching.disconnect();
	}, [watch, open]);
	const toggle = () => (more || open) && setOpen(!open);
	return (
		<div
			role={more || open ? "button" : undefined}
			tabIndex={more || open ? 0 : undefined}
			aria-expanded={more || open ? open : undefined}
			aria-label={more || open ? (open ? "Show less" : "Show all") : undefined}
			// A link or a button in the words, such as a code block's copy,
			// does its own thing rather than open or close the message.
			onClick={(event) =>
				event.target instanceof Element &&
				event.target.closest("a, button") !== null
					? undefined
					: toggle()
			}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle();
				}
			}}
			className={cn(
				"aui-user-message-content outline-none focus-visible:ring-2 focus-visible:ring-ring",
				USER_BOX,
				dictated && ["relative", DICTATED_BOX],
				// Held for its menu on a phone, rather than iOS selecting
				// a word with its own menu.
				"max-sm:pointer-coarse:select-none max-sm:pointer-coarse:[-webkit-touch-callout:none]",
				// Raised by a shadow while its message is stuck atop the thread.
				"[@container_scroll-state(stuck:top)]:shadow-[0_6px_16px_-6px_rgb(0_0_0/0.3)]",
				(more || open) && "cursor-pointer",
			)}
		>
			{dictated && (
				<MicIcon
					data-slot="aui_user-message-dictated"
					role="img"
					aria-label="Dictated"
					className={DICTATED_MIC}
				/>
			)}
			<div
				ref={text}
				className={cn(
					!open && [CLAMP, "overflow-hidden"],
					// Open, it still sticks atop a wide thread, so it scrolls past
					// half the screen rather than hide the reply.
					open && "md:max-h-[50dvh] md:overflow-y-auto",
					!open && more && CUT_FADE,
				)}
			>
				{children}
			</div>
		</div>
	);
};
