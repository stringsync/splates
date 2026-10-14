"use client";

import { FileText, PlayIcon } from "lucide-react";
import { type FC } from "react";
import { attachmentName, shelfOf, TILE } from "#dev/attachment-chips.tsx";
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
import { FileIcon } from "#dev/file-chip.tsx";
import { cn } from "#dev/lib/utils.ts";
import { ITEM, type Shown, useLightbox } from "#dev/lightbox.tsx";

/**
 * How a tile shows what it holds: an image or a recording as itself, opening
 * in the lightbox, and any other file by its name.
 */
type Kind = "image" | "video" | "file";
/** The kind of tile for an attachment of `type` holding `contentType`. */
export const kindOf = (type: string, contentType: string | undefined): Kind =>
	contentType?.startsWith("video/")
		? "video"
		: type === "image" || contentType?.startsWith("image/")
			? "image"
			: "file";
/** What the lightbox shows of an attachment, on the tile that opens it. */
export const shown = (src: string, name: string, kind: Kind) => ({
	[ITEM]: JSON.stringify({
		url: src,
		alt: name,
		video: kind === "video",
	} satisfies Shown),
});
/** A tile's look for each kind: a file is wide enough to name. */
export const tileSize = (kind: Kind) =>
	kind === "file" ? "h-14 w-auto max-w-48" : "size-14";
export const AttachmentThumb: FC<{
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
