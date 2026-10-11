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
	PlusIcon,
	XIcon,
} from "lucide-react";
import type { FC } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#dev/components/ui/avatar.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { useAttachmentSrc } from "#dev/hooks/use-attachment-src.ts";
import { cn } from "#dev/lib/utils.ts";
import { GROUP, ITEM, type Shown, useLightbox } from "#dev/lightbox.tsx";

/** What the lightbox shows of an image attachment, on the tile that opens it. */
const shown = (src: string, name: string) => ({
	[ITEM]: JSON.stringify({ url: src, alt: name, video: false } satisfies Shown),
});

const AttachmentThumb: FC<{ src: string | undefined }> = ({ src }) => {
	return (
		<Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
			<AvatarImage
				src={src}
				alt=""
				className="aui-attachment-tile-image rounded-none object-cover"
			/>
			<AvatarFallback>
				<FileText className="aui-attachment-tile-fallback-icon text-muted-foreground/80 size-6 stroke-[1.5]" />
			</AvatarFallback>
		</Avatar>
	);
};

const AttachmentUI: FC = () => {
	const aui = useAui();
	const isComposer = aui.attachment.source !== "message";
	const src = useAttachmentSrc();
	const { open, lightbox } = useLightbox();

	const isImage = useAuiState((s) => s.attachment.type === "image");
	const name = useAuiState((s) => s.attachment.name);
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
								{...(src ? shown(src, name) : {})}
								onClick={src ? (e) => open(e.currentTarget) : undefined}
								className={cn(
									"aui-attachment-tile bg-muted hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative size-14 overflow-hidden rounded-[calc(var(--composer-radius,1rem)-var(--composer-padding,8px))] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-1 motion-reduce:transition-none dark:after:ring-white/10",
									src ? "cursor-zoom-in active:scale-[0.96]" : "cursor-default",
									isError &&
										"after:ring-destructive/60 dark:after:ring-destructive/60",
								)}
								role={src ? "button" : "group"}
								tabIndex={0}
								onKeyDown={
									src
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
									src
										? (e) => {
												if (e.key === " ") {
													e.currentTarget.click();
												}
											}
										: undefined
								}
								aria-label={`${src ? `Preview ${name}` : `${typeLabel} attachment ${name}`}${
									isError ? ", upload failed" : isUploading ? ", uploading" : ""
								}`}
							/>
						}
					>
						<AttachmentThumb src={src} />
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
					{isComposer && <AttachmentRemove name={name} />}
				</AttachmentPrimitive.Root>
				<TooltipContent side="top">
					<AttachmentPrimitive.Name />
					{errorMessage && (
						<p className="aui-attachment-error-message">{errorMessage}</p>
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

const AttachmentRemove: FC<{ name: string }> = ({ name }) => {
	return (
		<AttachmentPrimitive.Remove
			render={
				<TooltipIconButton
					tooltip={`Remove ${name}`}
					className="aui-attachment-tile-remove absolute end-1 top-1 size-5 rounded-full bg-black/50! text-white after:absolute after:-inset-1.5 hover:bg-black/70! hover:text-white! active:scale-[0.96] motion-reduce:transition-none"
					side="top"
				/>
			}
		>
			<XIcon className="aui-attachment-remove-icon size-3 stroke-[2.5]" />
		</AttachmentPrimitive.Remove>
	);
};

export const UserMessageAttachments: FC = () => {
	return (
		<div
			{...{ [GROUP]: "" }}
			className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2 empty:hidden"
		>
			<MessagePrimitive.Attachments>
				{() => <AttachmentUI />}
			</MessagePrimitive.Attachments>
		</div>
	);
};

export const ComposerAttachments: FC = () => {
	return (
		<div
			{...{ [GROUP]: "" }}
			className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden"
		>
			<ComposerPrimitive.Attachments>
				{() => <AttachmentUI />}
			</ComposerPrimitive.Attachments>
		</div>
	);
};

export const ComposerAddAttachment: FC = () => {
	return (
		<ComposerPrimitive.AddAttachment
			render={
				<TooltipIconButton
					tooltip="Add Attachment"
					side="bottom"
					variant="ghost"
					size="icon"
					className="aui-composer-add-attachment text-muted-foreground hover:text-foreground size-7 rounded-full"
					aria-label="Add Attachment"
				/>
			}
		>
			<PlusIcon className="aui-attachment-add-icon size-4" />
		</ComposerPrimitive.AddAttachment>
	);
};

/**
 * An image sent in a message, outside any attachment's context: a tile the
 * size of the composer's, which opens in the lightbox among the others beside
 * it.
 */
export const ImageTile: FC<{ src: string; name: string }> = ({ src, name }) => {
	const { open, lightbox } = useLightbox();
	return (
		<>
			<button
				type="button"
				{...shown(src, name)}
				aria-label={`Preview ${name}`}
				onClick={(e) => open(e.currentTarget)}
				className="aui-attachment-tile bg-muted hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative size-14 cursor-zoom-in overflow-hidden rounded-[calc(var(--composer-radius,1rem)-var(--composer-padding,8px))] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-1 active:scale-[0.96] motion-reduce:transition-none dark:after:ring-white/10"
			>
				<AttachmentThumb src={src} />
			</button>
			{lightbox}
		</>
	);
};
