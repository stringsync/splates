"use client";

import {
	AttachmentPrimitive,
	ComposerPrimitive,
	MessagePrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import {
	AlertCircleIcon,
	FileText,
	Loader2Icon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { type FC, useContext, useRef, useState } from "react";
import { useAnnotate } from "#dev/annotate.tsx";
import { Annotation } from "#dev/annotation.ts";
import {
	attachmentName,
	chippedAlready,
	type Placed,
	shelfOf,
	TILE,
} from "#dev/attachment-chips.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#dev/components/ui/avatar.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { composerIn, ForgetAttachment } from "#dev/composer-editor.tsx";
import { FileIcon } from "#dev/file-chip.tsx";
import { useAttachmentSrc } from "#dev/hooks/use-attachment-src.ts";
import { useHeld } from "#dev/hooks/use-held.ts";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import { GROUP, ITEM, type Shown, useLightbox } from "#dev/lightbox.tsx";

/**
 * How a tile shows what it holds: an image or a recording as itself, opening
 * in the lightbox, and any other file by its name.
 */
type Kind = "image" | "video" | "file";

/** The kind of tile for an attachment of `type` holding `contentType`. */
const kindOf = (type: string, contentType: string | undefined): Kind =>
	contentType?.startsWith("video/")
		? "video"
		: type === "image" || contentType?.startsWith("image/")
			? "image"
			: "file";

/** What the lightbox shows of an attachment, on the tile that opens it. */
const shown = (src: string, name: string, kind: Kind) => ({
	[ITEM]: JSON.stringify({
		url: src,
		alt: name,
		video: kind === "video",
	} satisfies Shown),
});

/** A tile's look for each kind: a file is wide enough to name. */
const tileSize = (kind: Kind) =>
	kind === "file" ? "h-14 w-auto max-w-48" : "size-14";

const AttachmentThumb: FC<{
	src: string | undefined;
	kind: Kind;
	name: string;
}> = ({ src, kind, name }) => {
	if (kind === "file") {
		return (
			<span className="flex h-full items-center gap-2 px-3">
				<FileIcon path={name} className="size-5" />
				<span className="truncate text-xs">{name}</span>
			</span>
		);
	}
	if (kind === "video") {
		return (
			<span className="relative block h-full w-full">
				{src !== undefined && (
					// biome-ignore lint/a11y/useMediaCaption: a still of the recording, played in the lightbox
					<video
						src={src}
						muted
						preload="metadata"
						className="aui-attachment-tile-image h-full w-full object-cover"
					/>
				)}
				<span className="absolute inset-0 flex items-center justify-center">
					<PlayIcon className="size-5 fill-white text-white drop-shadow" />
				</span>
			</span>
		);
	}
	return (
		<Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none after:hidden">
			<AvatarImage
				src={src}
				alt=""
				className="aui-attachment-tile-image rounded-none object-cover"
			/>
			<AvatarFallback className="rounded-none">
				<FileText className="aui-attachment-tile-fallback-icon text-muted-foreground/80 size-6 stroke-[1.5]" />
			</AvatarFallback>
		</Avatar>
	);
};

const AttachmentTile: FC = () => {
	const aui = useAui();
	const isComposer = aui.attachment.source !== "message";
	const src = useAttachmentSrc();
	const { open, lightbox } = useLightbox();
	// Marked up from the composer, the keyboard goes back to writing.
	const input = useRef<HTMLElement | null>(null);
	const annotator = useAnnotate(input);

	const kind = useAuiState((s) =>
		kindOf(s.attachment.type, s.attachment.contentType),
	);
	const isImage = kind === "image";
	const name = useAuiState((s) => s.attachment.name);
	// The composer's attachments are named by their place on their shelf,
	// images apart from other files, as the agent gets them.
	const shelf = useAuiState((s) => shelfOf(s.attachment.type));
	const place = useAuiState((s) =>
		isComposer
			? s.composer.attachments
					.filter((each) => shelfOf(each.type) === shelf)
					.findIndex((each) => each.id === s.attachment.id)
			: -1,
	);
	// Only an image or a recording opens in the lightbox.
	const shows = src !== undefined && kind !== "file";
	// An image on its way opens to be marked up rather than only looked at.
	const file = useAuiState((s) =>
		isComposer && s.attachment.type === "image" ? s.attachment.file : undefined,
	);
	const annotate = async (tile: HTMLElement, image: File) => {
		const form = tile.closest("form");
		input.current = form === null ? null : composerIn(form);
		const marked = await annotator.open(image);
		if (marked !== image) {
			// It keeps the chip the image it stands in for has.
			chippedAlready(marked);
			await replace(aui.composer(), aui.attachment().getState().id, marked);
			// The tile, and the annotator with it, went with the image it showed.
			input.current?.focus();
		}
	};
	const typeLabel = useAuiState((s) => {
		const type = s.attachment.type;
		switch (type) {
			case "image":
				return "Image";
			case "document":
				return "Document";
			case "file":
				return "File";
			default:
				return type;
		}
	});

	// An attachment on a submission is still being prepared, whether or not the
	// adapter reports progress while it uploads.
	const uploadState = useAuiState((s) =>
		s.attachment.status.type === "incomplete" &&
		s.attachment.status.reason === "error"
			? "error"
			: s.attachment.status.type === "running" ||
					(s.optional.message?.submission !== undefined &&
						s.attachment.status.type !== "complete")
				? "uploading"
				: undefined,
	);
	const isUploading = uploadState === "uploading";
	const isError = uploadState === "error";

	const errorMessage = useAuiState((s) =>
		s.attachment.status.type === "incomplete" &&
		s.attachment.status.reason === "error"
			? (s.attachment.status.message ?? "Upload failed")
			: undefined,
	);

	return (
		<TooltipProvider>
			<Tooltip>
				<AttachmentPrimitive.Root
					className={cn(
						"aui-attachment-root relative",
						isComposer &&
							"animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
						isImage &&
							!isComposer &&
							"aui-attachment-root-message only:*:first:size-24",
					)}
				>
					<TooltipTrigger
						render={
							<div
								{...(shows ? shown(src, name, kind) : {})}
								{...(place >= 0
									? { [TILE]: attachmentName(shelf, place) }
									: {})}
								onClick={
									file
										? (e) => void annotate(e.currentTarget, file)
										: shows
											? (e) => open(e.currentTarget)
											: undefined
								}
								className={cn(
									tileSize(kind),
									// Clear of the remove button in its corner.
									isComposer && kind === "file" && "pe-4",
									"aui-attachment-tile bg-muted hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative overflow-hidden rounded-[calc(var(--composer-radius,1rem)-var(--composer-padding,8px))] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-1 motion-reduce:transition-none dark:after:ring-white/10",
									file
										? "group/annotate cursor-pointer active:scale-[0.96]"
										: shows
											? "cursor-zoom-in active:scale-[0.96]"
											: "cursor-default",
									isError &&
										"after:ring-destructive/60 dark:after:ring-destructive/60",
								)}
								role={shows ? "button" : "group"}
								tabIndex={0}
								onKeyDown={
									shows
										? (e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													e.currentTarget.click();
												} else if (e.key === " ") {
													e.preventDefault();
												}
											}
										: undefined
								}
								onKeyUp={
									shows
										? (e) => {
												if (e.key === " ") {
													e.currentTarget.click();
												}
											}
										: undefined
								}
								aria-label={`${file ? `Mark up ${name}` : shows ? `Preview ${name}` : `${typeLabel} attachment ${name}`}${
									isError ? ", upload failed" : isUploading ? ", uploading" : ""
								}`}
							/>
						}
					>
						<AttachmentThumb src={src} kind={kind} name={name} />
						{file && !isUploading && (
							<div
								aria-hidden="true"
								className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/annotate:opacity-100 group-focus-visible/annotate:opacity-100"
							>
								<PencilIcon className="size-4 text-white" />
							</div>
						)}
						{isUploading && (
							<div
								aria-hidden="true"
								className="aui-attachment-tile-uploading bg-background/60 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
							>
								<Loader2Icon className="text-muted-foreground size-4 animate-spin" />
							</div>
						)}
						{isError && (
							<div
								aria-hidden="true"
								className="aui-attachment-tile-error bg-background/70 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
							>
								<AlertCircleIcon className="text-destructive size-4" />
							</div>
						)}
					</TooltipTrigger>
					{lightbox}
					{annotator.annotate}
					{isComposer && (
						<AttachmentRemove
							name={name}
							placed={{ shelf, at: place + 1 }}
							marks={Annotation.marksOn(file)}
						/>
					)}
				</AttachmentPrimitive.Root>
				<TooltipContent side="top">
					{place >= 0 && `${attachmentName(shelf, place)}: `}
					<AttachmentPrimitive.Name />
					{file && <p className="text-muted-foreground">Click to mark up</p>}
					{errorMessage && (
						<p className="aui-attachment-error-message">{errorMessage}</p>
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

const REMOVE =
	"aui-attachment-tile-remove absolute end-1 top-1 size-5 rounded-full bg-black/50! text-white after:absolute after:-inset-1.5 hover:bg-black/70! hover:text-white! active:scale-[0.96] motion-reduce:transition-none";

/**
 * The tile's remove button, which takes the attachment's chips out of the
 * text with it. An image with marks drawn on it asks first, since the marks
 * go with it.
 */
const AttachmentRemove: FC<{ name: string; placed: Placed; marks: number }> = ({
	name,
	placed,
	marks,
}) => {
	const aui = useAui();
	const forget = useContext(ForgetAttachment);
	const [asking, setAsking] = useState(false);
	const remove = () => {
		forget(placed);
		void aui.attachment().remove();
	};
	const many = marks === 1 ? "its mark" : `its ${marks} marks`;
	return (
		<>
			<TooltipIconButton
				tooltip={`Remove ${name}`}
				className={REMOVE}
				side="top"
				onClick={() => (marks === 0 ? remove() : setAsking(true))}
			>
				<XIcon className="aui-attachment-remove-icon size-3 stroke-[2.5]" />
			</TooltipIconButton>
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Remove this image?</DialogTitle>
						<DialogDescription>
							{name} goes, and {many} with it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setAsking(false)}>
							Keep
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setAsking(false);
								remove();
							}}
						>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};

export const UserMessageAttachments: FC = () => {
	return (
		<div
			{...{ [GROUP]: "" }}
			className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2 empty:hidden"
		>
			<MessagePrimitive.Attachments>
				{() => <AttachmentTile />}
			</MessagePrimitive.Attachments>
		</div>
	);
};

export const ComposerAttachments: FC = () => {
	return (
		<div
			{...{ [GROUP]: "" }}
			className="aui-composer-attachments flex w-full flex-row items-start gap-2 overflow-x-auto empty:hidden"
		>
			<ComposerPrimitive.Attachments>
				{() => <AttachmentTile />}
			</ComposerPrimitive.Attachments>
		</div>
	);
};

/**
 * Picks files to attach, as its shortcut does, showing its key while ⌥⌘ is
 * held.
 */
export const ComposerAddAttachment: FC = () => {
	const held = useHeld();
	const shortcut = useShortcutLabel("shortcuts.attach");
	const key = useHeldKey("shortcuts.attach");
	return (
		<ComposerPrimitive.AddAttachment
			render={
				<TooltipIconButton
					tooltip={
						shortcut === null ? "Attach files" : `Attach files (${shortcut})`
					}
					side="bottom"
					variant="ghost"
					size="icon"
					className={cn(
						ATTACH,
						"text-muted-foreground hover:text-foreground size-7 rounded-full",
					)}
					aria-label="Attach files"
				/>
			}
		>
			{held && key !== null ? (
				<Kbd aria-hidden>{key}</Kbd>
			) : (
				<PlusIcon className="aui-attachment-add-icon size-4" />
			)}
		</ComposerPrimitive.AddAttachment>
	);
};

/** Marks each composer's attach button, for ⌥⌘; to find. */
const ATTACH = "aui-composer-add-attachment";

/**
 * Its shortcut, ⌥⌘; unless set otherwise, picks files to attach in the
 * composer being written in, or else the first one showing. Once per page,
 * so one press opens one picker.
 */
export function useAttachKey(): void {
	useShortcut("shortcuts.attach", () => {
		const shown = [
			...document.querySelectorAll<HTMLButtonElement>(`.${ATTACH}`),
		].filter((each) => each.getClientRects().length > 0);
		const focused = document.activeElement?.closest("form");
		const button = shown.find((each) => focused?.contains(each)) ?? shown[0];
		button?.click();
		return button !== undefined;
	});
}

const SENT =
	"aui-attachment-tile bg-muted hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative overflow-hidden rounded-[calc(var(--composer-radius,1rem)-var(--composer-padding,8px))] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-1 active:scale-[0.96] motion-reduce:transition-none dark:after:ring-white/10";

/**
 * A file sent in a message, outside any attachment's context: a tile the
 * size of the composer's. An image or a recording opens in the lightbox among
 * the others beside it; any other file opens from where it is kept, or
 * downloads when the browser cannot show it.
 */
export const SentTile: FC<{
	src: string;
	name: string;
	type: string;
	contentType: string | undefined;
	/** Its place on its shelf of the message's attachments, which its chips name. */
	place: number;
}> = ({ src, name, type, contentType, place }) => {
	const { open, lightbox } = useLightbox();
	const kind = kindOf(type, contentType);
	const called = attachmentName(shelfOf(type), place);
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger
					render={
						kind === "file" ? (
							<a
								href={src}
								target="_blank"
								rel="noreferrer"
								{...{ [TILE]: called }}
								className={cn(SENT, tileSize(kind), "block")}
							/>
						) : (
							<button
								type="button"
								{...shown(src, name, kind)}
								{...{ [TILE]: called }}
								aria-label={`Preview ${name}`}
								onClick={(e) => open(e.currentTarget)}
								className={cn(SENT, tileSize(kind), "cursor-zoom-in")}
							/>
						)
					}
				>
					<AttachmentThumb src={src} kind={kind} name={name} />
				</TooltipTrigger>
				<TooltipContent side="top">
					{called}: {name}
				</TooltipContent>
			</Tooltip>
			{lightbox}
		</TooltipProvider>
	);
};

/**
 * Puts `file` in the place of attachment `id` in `composer`. Nothing replaces
 * an attachment where it is, so it goes, with those after it, and they come
 * back in their order.
 */
async function replace(
	composer: ReturnType<ReturnType<typeof useAui>["composer"]>,
	id: string,
	file: File,
): Promise<void> {
	const all = composer.getState().attachments;
	const after = all.slice(all.findIndex((each) => each.id === id) + 1);
	for (const each of [{ id }, ...after]) {
		await composer.attachment({ id: each.id }).remove();
	}
	await composer.addAttachment(file);
	for (const each of after) {
		await composer.addAttachment(
			each.file ?? {
				type: each.type,
				name: each.name,
				contentType: each.contentType,
				content: each.content ?? [],
			},
		);
	}
}
