import { FileIcon, ImageIcon } from "lucide-react";
import { createContext, type JSX } from "react";
import { outsideCode } from "./markdown";

/**
 * Which count an attachment is named in: its images, which an agent that
 * takes images sees, and every other file, which it gets as a link.
 */
export type Shelf = "image" | "file";

const WORDS: Record<Shelf, string> = { image: "Image", file: "File" };

/** The shelf an attachment of `type` is counted on. */
export function shelfOf(type: string): Shelf {
	return type === "image" ? "image" : "file";
}

/**
 * An attachment named in a line, as the composer writes its chip: `[Image 2]`
 * for the second image the message carries and `[File 1]` for its first
 * other file, the order the agent is sent each in.
 */
export const ATTACHMENT_REFERENCE = /\[((?:Image|File) (\d+))\]/;

/** Where a link written by `linkAttachments` points, read back by `attachmentIn`. */
const ATTACHMENT_LINK = /^#attached-(image|file)=(\d+)$/;

/** What the attachment at `at`, counted from 0, on its message's `shelf` is called. */
export function attachmentName(shelf: Shelf, at: number): string {
	return `${WORDS[shelf]} ${at + 1}`;
}

/** An attachment by its shelf and its place there, counted from 1. */
export interface Placed {
	shelf: Shelf;
	at: number;
}

/**
 * Takes the chips of attachment `placed` out of the composer, as it is
 * removed.
 */
export const ForgetAttachment = createContext<(placed: Placed) => void>(
	() => undefined,
);

/** Which attachment `name` calls, or null when it names none. */
export function attachmentNumber(name: string): Placed | null {
	const found = /^(Image|File) (\d+)$/.exec(name);
	return found === null
		? null
		: {
				shelf: found[1] === "Image" ? "image" : "file",
				at: Number(found[2]),
			};
}

/**
 * The files a message carries whose chip is written already or was left out
 * on purpose, so attaching one writes its chip once: not again when it comes
 * back, marked up or sent back unsent.
 */
const chipped = new WeakSet<File>();

/**
 * Whether `file` is newly attached and wants its chip written, which it
 * wants only once.
 */
export function wantsChip(file: File): boolean {
	if (chipped.has(file)) {
		return false;
	}
	chipped.add(file);
	return true;
}

/** Takes `file` as chipped already, for one that stands in for another. */
export function chippedAlready(file: File): void {
	chipped.add(file);
}

/**
 * `text` with each attachment chip outside code made a link that
 * `attachmentIn` reads back, so a sent message draws it as its chip where it
 * stands.
 */
export function linkAttachments(text: string): string {
	return outsideCode(text, (prose) =>
		prose.replace(
			new RegExp(ATTACHMENT_REFERENCE.source, "g"),
			(_, name: string, at: string) =>
				`[${name}](#attached-${attachmentNumber(name)?.shelf}=${at})`,
		),
	);
}

/** The attachment a link written by `linkAttachments` names, or null. */
export function attachmentIn(href: string | undefined): Placed | null {
	const link = ATTACHMENT_LINK.exec(href ?? "");
	return link === null
		? null
		: { shelf: link[1] as Shelf, at: Number(link[2]) };
}

/** What an attachment's chip shows: its kind's icon, and its name. */
export function ChipFace({ shelf, at }: Placed): JSX.Element {
	const Icon = shelf === "image" ? ImageIcon : FileIcon;
	return (
		<>
			<Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
			{attachmentName(shelf, at - 1)}
		</>
	);
}

export const ATTACHMENT_CHIP =
	"inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 align-middle font-medium text-foreground/90 text-xs";
