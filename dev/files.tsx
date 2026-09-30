import { FileIcon, PaperclipIcon, XIcon } from "lucide-react";
import {
	type ClipboardEvent,
	type JSX,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { InputGroupButton } from "#dev/components/ui/input-group.tsx";
import { fileUrl } from "./api";

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Files on their way to being attached, and the ones already stored: what a
 * reply box and a todo both need. `keep` starts as every stored path.
 */
export function useFiles(stored: string[] = []) {
	const [files, setFiles] = useState<File[]>([]);
	const [keep, setKeep] = useState<string[]>(stored);
	const add = (added: Iterable<File>) => {
		const list = [...added];
		if (list.length > 0) {
			setFiles((files) => [...files, ...list]);
		}
	};
	// A screenshot pasted from the clipboard arrives as a file with no useful
	// name, which is fine: the server keeps whatever it is given.
	const paste = (event: ClipboardEvent<HTMLElement>) => {
		const pasted = [...event.clipboardData.files];
		if (pasted.length > 0) {
			event.preventDefault();
			add(pasted);
		}
	};
	return {
		files,
		keep,
		add,
		paste,
		drop: (index: number) =>
			setFiles((files) => files.filter((_, at) => at !== index)),
		unkeep: (path: string) =>
			setKeep((keep) => keep.filter((kept) => kept !== path)),
		/** Back to nothing attached, once what was attached has been sent. */
		clear: () => {
			setFiles([]);
			setKeep([]);
		},
		/** Anything to send: a new file, or a stored one still kept. */
		any: files.length > 0 || keep.length > 0,
	};
}

export type Files = ReturnType<typeof useFiles>;

/** The paperclip: picks any number of files of any kind. */
export function AttachButton({ files }: { files: Files }): JSX.Element {
	const picker = useRef<HTMLInputElement>(null);
	return (
		<>
			<InputGroupButton
				aria-label="attach files"
				size="icon-xs"
				variant="ghost"
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

/** Every file attached, stored or new, each with a way to drop it. */
export function FileList({ files }: { files: Files }): JSX.Element | null {
	if (!files.any) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-2">
			{files.keep.map((path) => (
				<Chip
					key={path}
					name={stored(path)}
					src={IMAGE.test(path) ? fileUrl(path) : undefined}
					href={fileUrl(path)}
					onRemove={() => files.unkeep(path)}
				/>
			))}
			{files.files.map((file, index) => (
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
	const image = file.type.startsWith("image/");
	// Revoked when the chip goes, or every pasted screenshot stays in memory for
	// as long as the page is open.
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!image) {
			return;
		}
		const created = URL.createObjectURL(file);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [file, image]);
	return (
		<Chip name={file.name} src={image ? url : undefined} onRemove={onRemove} />
	);
}

/** One file: a thumbnail for an image, its name otherwise. */
function Chip({
	name,
	src,
	href,
	onRemove,
}: {
	name: string;
	src?: string;
	href?: string;
	onRemove?: () => void;
}): JSX.Element {
	const face =
		src === undefined ? (
			<div className="flex h-16 max-w-40 items-center gap-2 rounded-md border px-3 text-xs">
				<FileIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate">{name}</span>
			</div>
		) : (
			<img
				src={src}
				alt={name}
				className="size-16 rounded-md border object-cover"
			/>
		);
	return (
		<div className="relative">
			{href === undefined ? (
				face
			) : (
				<a href={href} target="_blank" rel="noreferrer">
					{face}
				</a>
			)}
			{onRemove && (
				<Button
					aria-label={`remove ${name}`}
					variant="secondary"
					size="icon-xs"
					className="absolute -top-2 -right-2 rounded-full"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			)}
		</div>
	);
}

/** The id a stored name leads with: a uuid, or a test's counter. */
const STORED_ID = /^([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|\d+)-/i;

/** A stored file's name as given, without the id stored names lead with. */
export function stored(path: string): string {
	return (path.split("/").at(-1) ?? path).replace(STORED_ID, "");
}
