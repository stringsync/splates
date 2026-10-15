"use client";

import {
	ActionBarPrimitive,
	AuiIf,
	type CompleteAttachment,
	MessagePrimitive,
	type TextMessagePartComponent,
	useAuiState,
} from "@assistant-ui/react";
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
import { linkAttachments } from "#dev/attachment-chips.tsx";
import { repliesToReview } from "#dev/card-reply.tsx";
import { MarkdownText } from "#dev/components/assistant-ui/elements/markdown-text.tsx";
import {
	useAnchorAtOnce,
	useOpenAt,
} from "#dev/components/assistant-ui/elements/thread-scroll.aui.ts";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { useNameOf } from "#dev/conversation-names.ts";
import {
	DirectiveChip,
	DirectiveLine,
	isBare,
	linkDirectives,
	soleDirective,
	unshown,
} from "#dev/directives.tsx";
import { Held } from "#dev/handed-out.tsx";
import { cn } from "#dev/lib/utils.ts";
import {
	type Sent,
	SentAttachmentChip,
	SentAttachments,
	unnamed,
} from "#dev/sent-attachments.tsx";
import { Stamp, useStamps } from "#dev/stamp.tsx";
import { UnsentLine } from "#dev/unsent.tsx";
import { leadingDirectives, MERGE } from "../../../../prompts";

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
	const stamped = useAuiState((s) => {
		const at = s.message.metadata.custom.at;
		return typeof at === "string" ? at : null;
	});
	const at = stamps.shown ? stamped : null;
	const told = useAuiState((s) => {
		const from = s.message.metadata.custom.told;
		return typeof from === "string" ? from : null;
	});
	const teller = useContext(Held).find((each) => each.id === told);
	const dictated = useAuiState(
		(s) => s.message.metadata.custom.dictated === true,
	);
	const unsent = useAuiState((s) => {
		const at = s.message.metadata.custom.unsent;
		return typeof at === "number" ? at : null;
	});
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
	// A review's Merge, which the review's own line says was approved.
	const merged = useAuiState(
		(s) =>
			sole === MERGE && repliesToReview(s.thread.messages, s.message.index),
	);
	const sent = sentOf(attachments);
	if (sole !== null && sent.length === 0 && isBare(sole)) {
		// Not a primitive's root, which assistant-ui would anchor a reply's
		// turn to: it carries on the turn it comes in (see `carriesOn`).
		return (
			<div
				data-slot="aui_user-message-root"
				data-message-id={id}
				className={merged ? undefined : "px-2"}
				data-role="user"
			>
				{!merged && <DirectiveLine directive={sole} at={at} />}
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
	return (
		<MessagePrimitive.Root
			ref={unstuckTop}
			data-slot="aui_user-message-root"
			// What `useAnchorAtOnce` finds a new turn's start by, and `useOpenAt`
			// the first unseen message.
			data-message-id={id}
			className={cn(
				// No entrance: the thread jumps to it as it comes, with nothing
				// else in view, so a fade would show an empty thread for a frame.
				"flex flex-col gap-y-2 px-2",
				// Stuck atop the thread for as long as its turn is in view. Opaque,
				// so the reply cannot show past its rounded corners, then fading
				// the reply out over the 2rem below it, which its turn keeps clear
				// while it is not stuck (`data-sticks`). The margin alone is what
				// its turn holds it by, so the fade comes to the next message's
				// top as that pushes it out. On a phone the fade is half that, so
				// it hides less of a short screen.
				"bg-background sticky top-0 z-10 mb-2 [container-type:scroll-state]",
				"after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 max-sm:after:h-4 after:bg-linear-to-b after:from-background after:to-transparent",
			)}
			data-role="user"
			data-sticks
		>
			<div className="aui-user-message-content-wrapper group/user relative min-w-0">
				<Clamped watch={id} dictated={dictated}>
					{/* Only words: the files it carries are attachments, shown as
					their chips. */}
					<SentAttachments value={sent}>
						<Leading text={text} sent={sent} />
						<MessagePrimitive.Parts components={{ Text: UserText }} />
					</SentAttachments>
				</Clamped>
				<UserCopy />
			</div>
			{(steered || at !== null || told !== null) && (
				<div className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs">
					{at !== null && <Stamp at={at} />}
					{at !== null && told !== null && <span aria-hidden>·</span>}
					{told !== null && (
						<span data-slot="aui_user-message-told">
							from{" "}
							{teller === undefined ? (
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
			{unsent !== null && <UnsentLine at={unsent} />}
		</MessagePrimitive.Root>
	);
};
/** The files a message holds, where the page loads each from. */
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
							type: attachment.type,
							contentType: attachment.contentType,
						},
					]
				: [],
		),
	);
/**
 * Copies what the person said, from the message's top corner: there only
 * while the message is hovered or the button has focus, or always under a
 * finger, which cannot hover, and a check once it has copied. Beside the box rather than in it, since the box is itself a
 * button.
 */
const UserCopy: FC = () => (
	<ActionBarPrimitive.Copy
		render={
			<TooltipIconButton
				tooltip="Copy"
				className={cn(
					"aui-user-action-copy text-muted-foreground absolute end-1.5 top-1.5 size-6 pointer-coarse:end-0 pointer-coarse:top-0 pointer-coarse:size-10",
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
 * copy button. Smaller and tighter on a phone, where it sits atop a short
 * screen.
 */
const USER_BOX =
	"text-foreground bg-muted rounded-lg border border-foreground/15 ps-4 pe-9 py-2.5 max-sm:ps-3 max-sm:py-1.5 max-sm:text-sm wrap-break-word";
/**
 * Room at the box's start for the mic a dictated message shows, in the top
 * corner by its first line, which stays in view on a phone's one.
 */
const DICTATED_BOX = "ps-9 max-sm:ps-8";
const DICTATED_MIC =
	"text-muted-foreground absolute start-3 top-3.5 size-4 max-sm:start-2.5 max-sm:top-2.5 max-sm:size-3.5";
/**
 * Lines of a message shown before it is clicked open: one on a phone, four
 * on a wider screen. On a phone it sets the words' line height, so `1lh` is
 * one line of them, or shows the row of chips a message starts with, which
 * stands taller than a line.
 */
const CLAMP =
	"max-h-24 max-sm:max-h-[1lh] max-sm:leading-relaxed max-sm:has-[.aui-user-message-directives]:max-h-7";
/**
 * Where a cut message fades: its last lines on a wider screen. On a phone its
 * one line ends in an ellipsis instead (`CUT_LINE`), since a fade at its end
 * reads as a shadow over the copy button.
 */
const CUT_FADE =
	"sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]";
/** A message cut to one line on a phone, ending in an ellipsis. */
const CUT_LINE = "max-sm:line-clamp-1";
/**
 * A message cut to four lines (one on a phone), fading out where it is cut,
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
					// Open, it still sticks atop the thread, so it scrolls past half
					// the screen rather than hide the reply.
					open && "max-h-[50dvh] overflow-y-auto",
					!open && more && CUT_FADE,
					!open && CUT_LINE,
				)}
			>
				{children}
			</div>
		</div>
	);
};
