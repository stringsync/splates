"use client";

import {
	ActionBarPrimitive,
	AuiIf,
	type CompleteAttachment,
	MessagePrimitive,
	type TextMessagePartComponent,
	useAuiState,
} from "@assistant-ui/react";
import { CheckIcon, CopyIcon, CornerDownRightIcon } from "lucide-react";
import {
	type FC,
	type PropsWithChildren,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { linkAttachments, shelfOf } from "#dev/attachment-chips.tsx";
import { SentTile } from "#dev/components/assistant-ui/elements/attachment-thumb.tsx";
import { MarkdownText } from "#dev/components/assistant-ui/elements/markdown-text.tsx";
import {
	useAnchorAtOnce,
	useOpenAt,
} from "#dev/components/assistant-ui/elements/thread-scroll.aui.ts";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import {
	DirectiveCard,
	DirectiveChip,
	linkDirectives,
	soleDirective,
} from "#dev/directives.tsx";
import { cn } from "#dev/lib/utils.ts";
import { GROUP } from "#dev/lightbox.tsx";
import { leadingDirectives } from "../../../../prompts";

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
 * mentions a link to it, each system and file a chip, and its directives as
 * the chips the composer showed them as: those it starts with in a row above
 * its words, the rest where they stand.
 */
const UserText: TextMessagePartComponent = ({ text }) => {
	const { directives, rest } = leadingDirectives(text);
	return (
		<>
			{directives.length > 0 && (
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
				</span>
			)}
			{rest !== "" && <MarkdownText typed={afterDirectives} />}
		</>
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
	const sole = useAuiState((s) => {
		const [only, ...more] = s.message.parts;
		return only?.type === "text" && more.length === 0
			? soleDirective(only.text)
			: null;
	});
	if (sole !== null && (attachments ?? []).length === 0) {
		// A card, with nothing to stick atop its turn: what it asked is said once.
		return (
			<MessagePrimitive.Root
				data-slot="aui_user-message-root"
				data-message-id={id}
				className="px-2"
				data-role="user"
			>
				<DirectiveCard directive={sole} />
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
				<Clamped
					watch={id}
					head={<SentTiles attachments={attachments} />}
					files={(attachments ?? []).length > 0}
				>
					{/* Only words: the images it carries are attachments, shown as
					the tiles above. */}
					<MessagePrimitive.Parts components={{ Text: UserText }} />
				</Clamped>
				<UserCopy />
			</div>
			{steered && (
				<div
					data-slot="aui_user-message-steered"
					className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs"
				>
					<CornerDownRightIcon className="size-3" aria-hidden />
					Steered into the running turn
				</div>
			)}
		</MessagePrimitive.Root>
	);
};
/**
 * The files a message holds, at its start as the composer shows them, each
 * opening full size; nothing for a message without any.
 */
const SentTiles: FC<{
	attachments: readonly CompleteAttachment[] | undefined;
}> = ({ attachments = [] }) => {
	const sent = attachments.flatMap((attachment) =>
		(attachment.content ?? []).flatMap((part) =>
			part.type === "image" || part.type === "file"
				? [
						{
							...attachment,
							src: part.type === "image" ? part.image : part.data,
						},
					]
				: [],
		),
	);
	if (sent.length === 0) {
		return null;
	}
	return (
		<div
			data-slot="aui_user-message-images"
			// The lightbox steps through the images and recordings of one message.
			{...{ [GROUP]: "" }}
			// A tile opens the file, rather than the message it sits in.
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			className="flex flex-wrap gap-2 pb-2"
		>
			{sent.map((each) => (
				<SentTile
					key={each.src}
					src={each.src}
					name={each.name}
					type={each.type}
					contentType={each.contentType}
					// Its images come first, then its other files, each in the
					// order the agent is sent them.
					place={sent
						.filter((other) => shelfOf(other.type) === shelfOf(each.type))
						.indexOf(each)}
				/>
			))}
		</div>
	);
};
/**
 * Copies what the person said, from the message's top corner: there only
 * while the message is hovered or the button has focus, and a check once it
 * has copied. Beside the box rather than in it, since the box is itself a
 * button.
 */
const UserCopy: FC = () => (
	<ActionBarPrimitive.Copy
		render={
			<TooltipIconButton
				tooltip="Copy"
				className={cn(
					"aui-user-action-copy text-muted-foreground absolute end-1.5 top-1.5 size-6",
					"opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100 data-copied:opacity-100",
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
 * Lines of a message shown before it is clicked open: one on a phone, four
 * on a wider screen. On a phone it sets the words' line height, so `1lh` is
 * one line of them, or shows the row of chips a message starts with, which
 * stands taller than a line.
 */
const CLAMP =
	"max-h-24 max-sm:max-h-[1lh] max-sm:leading-relaxed max-sm:has-[.aui-user-message-directives]:max-h-7";
/**
 * How much of a message with files is shown before it is clicked open: its
 * row of tiles on a phone, and a line or two under it on a wider screen.
 */
const CLAMP_WITH_FILES = "max-h-32 max-sm:max-h-14";
/**
 * Where a cut message fades: the end of its one line on a phone, its last
 * lines on a wider screen.
 */
const CUT_FADE =
	"[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]";
/**
 * A message cut to four lines, or to its files and a line or two (one line,
 * or its files alone, on a phone), fading out where it is cut, and opened or
 * closed again by a click (or Enter) when there is more than fits.
 */
const Clamped: FC<
	PropsWithChildren<{
		/** Changes when the words do, to measure them again. */
		watch: string;
		/** Above the words, and cut with them: the files the message holds. */
		head?: ReactNode;
		/** Whether there are files above the words, which take more room. */
		files: boolean;
	}>
> = ({ watch, head, files, children }) => {
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
				// Raised by a shadow while its message is stuck atop the thread.
				"[@container_scroll-state(stuck:top)]:shadow-[0_6px_16px_-6px_rgb(0_0_0/0.3)]",
				(more || open) && "cursor-pointer",
			)}
		>
			<div
				ref={text}
				className={cn(
					// The files are cut with the words, so a message stuck atop the
					// thread is no taller for holding them.
					!open && [files ? CLAMP_WITH_FILES : CLAMP, "overflow-hidden"],
					// Open, it still sticks atop the thread, so it scrolls past half
					// the screen rather than hide the reply.
					open && "max-h-[50dvh] overflow-y-auto",
					!open && more && CUT_FADE,
				)}
			>
				{head}
				{children}
			</div>
		</div>
	);
};
