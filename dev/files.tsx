import { useReactive } from "@webappwiz/react";
import {
	EyeIcon,
	FileIcon,
	ImageIcon,
	PaperclipIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useRef } from "react";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { InputGroupButton } from "#dev/components/ui/input-group.tsx";
import { cn } from "#dev/lib/utils.ts";
import { fileUrl } from "./api";
import { ATTACHMENT_CHIP, type Shelf } from "./attachment-chips";
import { SEEN } from "./conversation-feed";
import { useFileSrc } from "./hooks/use-file-src";
import { GROUP, ITEM, type Shown, useLightbox } from "./lightbox";

export type FilesEvents = { changed: undefined };

/**
 * Files on their way to being attached, and the ones already stored: what a
 * reply box and a todo both need. `keep` starts as every stored path.
 */
export class Files implements Eventful<FilesEvents> {
	private readonly dispatcher = new Dispatcher<FilesEvents>();
	readonly events = this.dispatcher.events;

	/** New files, not yet sent. */
	files: File[] = [];
	/** Stored paths still kept. */
	keep: string[];

	constructor(stored: string[] = []) {
		this.keep = stored;
	}

	add(added: Iterable<File>): void {
		const list = [...added];
		if (list.length > 0) {
			this.set({ files: [...this.files, ...list] });
		}
	}

	/**
	 * Takes whatever files a paste carries, and keeps the paste from also
	 * landing as text when it carried any.
	 */
	paste(event: { clipboardData: DataTransfer; preventDefault(): void }): void {
		// A screenshot pasted from the clipboard arrives as a file with no useful
		// name, which is fine: the server keeps whatever it is given.
		const pasted = [...event.clipboardData.files];
		if (pasted.length > 0) {
			event.preventDefault();
			this.add(pasted);
		}
	}

	/** The new files counted on `shelf`, in the order they were attached. */
	on(shelf: Shelf): File[] {
		return this.files.filter((file) => fileShelf(file) === shelf);
	}

	/** Puts `by` in the place of `file`, as a mark up does. */
	replace(file: File, by: File): void {
		this.set({ files: this.files.map((each) => (each === file ? by : each)) });
	}

	/** Takes `file` off. */
	remove(file: File): void {
		this.set({ files: this.files.filter((each) => each !== file) });
	}

	drop(index: number): void {
		this.set({ files: this.files.filter((_, at) => at !== index) });
	}

	unkeep(path: string): void {
		this.set({ keep: this.keep.filter((kept) => kept !== path) });
	}

	/** Back to nothing attached, once what was attached has been sent. */
	clear(): void {
		this.set({ files: [], keep: [] });
	}

	/** Back to `stored` and nothing new, as when an edit is thrown away. */
	reset(stored: string[]): void {
		this.set({ files: [], keep: stored });
	}

	private set(next: Partial<Pick<Files, "files" | "keep">>): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

/** The shelf a reply counts `file` on: an image an agent is sent as such, or a file. */
export function fileShelf(file: File): Shelf {
	return SEEN.includes(file.type) ? "image" : "file";
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** The paperclip: picks any number of files of any kind. */
export function AttachButton({ files }: { files: Files }): JSX.Element {
	const picker = useRef<HTMLInputElement>(null);
	return (
		<>
			<InputGroupButton
				aria-label="attach files"
				size="icon-xs"
				variant="ghost"
				className="pointer-coarse:size-10"
				onClick={() => picker.current?.click()}
			>
				<PaperclipIcon />
			</InputGroupButton>
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					files.add(event.target.files ?? []);
					event.target.value = "";
				}}
			/>
		</>
	);
}

/** Every file attached, stored or new, each a chip with a way to drop it. */
export function FileList({ files }: { files: Files }): JSX.Element | null {
	const { added, kept } = useReactive(
		files,
		(files) => ({ added: files.files, kept: files.keep }),
		["changed"],
	);
	if (added.length === 0 && kept.length === 0) {
		return null;
	}
	// The lightbox steps through the images of one list, stored and new alike.
	return (
		<div {...{ [GROUP]: "" }} className="flex flex-wrap gap-1.5">
			{kept.map((path) => (
				<Chip
					key={path}
					name={stored(path)}
					src={fileUrl(path)}
					image={IMAGE.test(path)}
					onRemove={() => files.unkeep(path)}
				/>
			))}
			{added.map((file, index) => (
				<New
					key={`${file.name}-${file.size}-${file.lastModified}`}
					file={file}
					onRemove={() => files.drop(index)}
				/>
			))}
		</div>
	);
}

function New({
	file,
	onRemove,
}: {
	file: File;
	onRemove: () => void;
}): JSX.Element {
	return (
		<Chip
			name={file.name}
			src={useFileSrc(file)}
			image={file.type.startsWith("image/")}
			onRemove={onRemove}
		/>
	);
}

/**
 * One file, as the composer's chip of an attachment: its kind's icon and its
 * name, a tap opening a menu to view it, an image in the lightbox, or to
 * remove it.
 */
function Chip({
	name,
	src,
	image,
	onRemove,
}: {
	name: string;
	/** Where the page loads it from, once it can. */
	src: string | undefined;
	image: boolean;
	onRemove?: () => void;
}): JSX.Element {
	const { open, lightbox } = useLightbox();
	const chip = useRef<HTMLButtonElement>(null);
	const Icon = image ? ImageIcon : FileIcon;
	const view = () => {
		if (!image) {
			window.open(src, "_blank", "noreferrer");
		} else if (chip.current !== null) {
			open(chip.current);
		}
	};
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					ref={chip}
					{...(image && src !== undefined
						? {
								[ITEM]: JSON.stringify({
									url: src,
									alt: name,
									video: false,
								} satisfies Shown),
							}
						: {})}
					title={name}
					className={cn(
						ATTACHMENT_CHIP,
						"max-w-56 cursor-pointer hover:bg-muted data-popup-open:bg-muted pointer-coarse:h-8",
					)}
				>
					<Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
					<span className="truncate">{name}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-auto">
					<DropdownMenuItem disabled={src === undefined} onClick={view}>
						<EyeIcon />
						View
					</DropdownMenuItem>
					{onRemove && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={onRemove}>
								<XIcon />
								Remove
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{lightbox}
		</>
	);
}

/** The id a stored name leads with: a uuid, or a test's counter. */
const STORED_ID = /^([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|\d+)-/i;

/** A stored file's name as given, without the id stored names lead with. */
export function stored(path: string): string {
	return (path.split("/").at(-1) ?? path).replace(STORED_ID, "");
}

/** Names the files a reload dropped from a draft, to attach again. */
export function Dropped({ names }: { names: string[] }): JSX.Element | null {
	if (names.length === 0) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			Lost on reload, attach again: {names.join(", ")}
		</p>
	);
}
