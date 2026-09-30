import type { JSX, ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "#dev/components/ui/dialog.tsx";
import {
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import { fileUrl } from "./api";
import { Markdown } from "./markdown";

/**
 * A bottom sheet for one question to read and answer: its number and task,
 * its title and body, then whatever can be done about it.
 */
export function ItemSheet({
	task,
	id,
	title,
	body = "",
	children,
}: {
	task: string;
	/** `Q3`. */
	id: string;
	title: string;
	/** Markdown under the title, images and all. */
	body?: string;
	children: ReactNode;
}): JSX.Element {
	const image = (path: string, alt: string) => (
		<Lightbox src={fileUrl(path, task)} alt={alt || path} />
	);
	return (
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[90dvh] max-w-2xl overflow-y-auto rounded-t-xl"
		>
			<SheetHeader className="pr-12">
				<div className="flex items-center gap-2 text-muted-foreground text-xs">
					<span className="tabular-nums">{id}</span>
					<span className="truncate">{task}</span>
				</div>
				<SheetTitle>
					<Markdown text={title} image={image} />
				</SheetTitle>
			</SheetHeader>
			<div className="flex flex-col gap-4 px-4 pb-4">
				{body !== "" && (
					<Markdown text={body} image={image} className="text-sm" />
				)}
				{children}
			</div>
		</SheetContent>
	);
}

/** An image a question shows: a thumbnail that opens full size. */
export function Lightbox({
	src,
	alt,
}: {
	src: string;
	alt: string;
}): JSX.Element {
	return (
		<Dialog>
			<DialogTrigger
				render={
					<button
						type="button"
						className="my-1 block overflow-hidden rounded-md border"
					/>
				}
			>
				<img src={src} alt={alt} className="max-h-48 w-auto object-contain" />
			</DialogTrigger>
			<DialogContent className="max-w-[95vw] p-2 sm:max-w-[95vw]">
				<DialogTitle className="sr-only">{alt}</DialogTitle>
				<img
					src={src}
					alt={alt}
					className="max-h-[85dvh] w-full rounded-md object-contain"
				/>
			</DialogContent>
		</Dialog>
	);
}

/** A line of markdown as it reads, for a row too short to render it. */
export function plain(text: string): string {
	return text.replaceAll("`", "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
}
