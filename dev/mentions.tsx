import { FileIcon, FolderIcon } from "lucide-react";
import {
	type ChangeEvent,
	type JSX,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#dev/lib/utils.ts";
import { paths as fetchPaths } from "./api";

/** As many as fit without the list needing a scroll of its own. */
const SHOWN = 8;
/** One row's height in pixels, fixed so the list never jumps as it filters. */
const ROW = 32;

/** Which side of the box the list opens on, and how tall it may get there. */
interface Place {
	below: boolean;
	room: number;
}

/** An `@` being typed: where it starts, and what follows it so far. */
interface Mention {
	start: number;
	query: string;
}

/**
 * Points an agent at a file or directory by typing `@` in a text box: a list
 * of the tree's paths, filtered as you type, and the path written in place of
 * what was typed. The list floats over the page, above the box or below it
 * when there is no room above, so nothing around it moves.
 *
 * The paths load once, when the box first shows, so there is nothing to wait
 * for at the `@`.
 */
export function useMentions<
	Box extends HTMLInputElement | HTMLTextAreaElement,
>({
	task,
	text,
	setText,
}: {
	/** Whose tree to list; empty for the main tree. */
	task: string;
	text: string;
	setText: (text: string) => void;
}) {
	const ref = useRef<Box>(null);
	const [all, setAll] = useState<string[]>([]);
	const [caret, setCaret] = useState(0);
	const [active, setActive] = useState(0);
	// Where Escape closed the list, so it stays closed until another `@`.
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [place, setPlace] = useState<Place>({
		below: false,
		room: SHOWN * ROW,
	});

	useEffect(() => {
		let live = true;
		fetchPaths(task).then(
			(found) => live && setAll(found),
			// Without the list, `@` is only a character: nothing else breaks.
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [task]);

	const mention = typedAt(text, caret);
	const matches =
		mention === null || mention.start === dismissed
			? []
			: rank(all, mention.query).slice(0, SHOWN);
	const open = matches.length > 0;
	const picked = Math.min(active, matches.length - 1);

	// Decided as the list opens, not while it filters, so it stays put.
	const opening = open && mention !== null;
	const _at = mention?.start;
	useEffect(() => {
		if (!opening || ref.current === null) {
			return;
		}
		const box = ref.current.getBoundingClientRect();
		// A sheet the box sits in clips anything past its edges, and the window
		// clips the rest.
		const frame = ref.current
			.closest("[data-slot=sheet-content]")
			?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
		const above = box.top - frame.top;
		const under = Math.min(frame.bottom, innerHeight) - box.bottom;
		const full = SHOWN * ROW + 10;
		// Above by choice, where a phone's keyboard cannot cover it; below
		// only when that has more room.
		const below = above < full && under > above;
		setPlace({ below, room: Math.min(full, (below ? under : above) - 8) });
		setActive(0);
	}, [opening]);

	const track = () => setCaret(ref.current?.selectionStart ?? 0);

	const insert = (path: string) => {
		if (mention === null) {
			return;
		}
		const end = mention.start + 1 + mention.query.length;
		// A directory keeps the list open on what is inside it; a file is done.
		const written = `@${path}${path.endsWith("/") ? "" : " "}`;
		const next = text.slice(0, mention.start) + written + text.slice(end);
		const after = mention.start + written.length;
		setText(next);
		setCaret(after);
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(after, after);
		});
	};

	return {
		ref,
		onChange: (event: ChangeEvent<Box>) => {
			setText(event.target.value);
			setCaret(event.target.selectionStart ?? event.target.value.length);
		},
		onSelect: track,
		onClick: track,
		/** Handles the keys the list takes while open; true when it took one. */
		onKeyDown: (event: KeyboardEvent<Box>): boolean => {
			if (!open) {
				return false;
			}
			const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
			if (move !== undefined) {
				setActive((picked + move + matches.length) % matches.length);
			} else if (event.key === "Enter" || event.key === "Tab") {
				insert(matches[picked] ?? "");
			} else if (event.key === "Escape") {
				setDismissed(mention?.start ?? null);
			} else {
				return false;
			}
			event.preventDefault();
			// Escape would otherwise close the sheet as well as the list.
			event.stopPropagation();
			return true;
		},
		menu: open ? (
			<Menu
				matches={matches}
				active={picked}
				place={place}
				onPick={insert}
				onHover={setActive}
			/>
		) : null,
	};
}

export type Mentions = ReturnType<typeof useMentions<HTMLTextAreaElement>>;

function Menu({
	matches,
	active,
	place,
	onPick,
	onHover,
}: {
	matches: string[];
	active: number;
	place: Place;
	onPick: (path: string) => void;
	onHover: (index: number) => void;
}): JSX.Element {
	return (
		<div
			role="listbox"
			aria-label="files"
			style={{ maxHeight: place.room }}
			className={cn(
				"absolute inset-x-0 z-50 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
				place.below ? "top-full mt-1" : "bottom-full mb-1",
			)}
		>
			{matches.map((path, index) => {
				const directory = path.endsWith("/");
				const Icon = directory ? FolderIcon : FileIcon;
				const [folder, name] = split(path);
				return (
					<div
						key={path}
						role="option"
						tabIndex={-1}
						aria-selected={index === active}
						// Down, not click, so the box keeps its focus and caret.
						onMouseDown={(event) => {
							event.preventDefault();
							onPick(path);
						}}
						onMouseEnter={() => onHover(index)}
						// Kept in view as the arrow keys move past the room there is.
						ref={(row) => {
							if (index === active) {
								row?.scrollIntoView({ block: "nearest" });
							}
						}}
						style={{ height: ROW }}
						className={cn(
							"flex cursor-default items-center gap-2 rounded-md px-2 text-sm",
							index === active && "bg-muted",
						)}
					>
						<Icon className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate">{name}</span>
						{/* Gives way first, so the name keeps as much as it can. */}
						<span className="shrink-1000 truncate text-muted-foreground text-xs">
							{folder}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** The `@` the caret is in, if any: one at the start or after a space. */
export function typedAt(text: string, caret: number): Mention | null {
	const found = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
	if (found === null) {
		return null;
	}
	const query = found[2] ?? "";
	return { start: caret - query.length - 1, query };
}

/**
 * The paths that match what was typed, best first: a name that starts with it,
 * then any that contain it, then the ones that hold its letters in order.
 * Shallower before deeper, so a directory's own entries lead once it is picked,
 * and directories before files.
 */
export function rank(paths: string[], query: string): string[] {
	const typed = query.toLowerCase();
	const scored: { path: string; score: number; depth: number }[] = [];
	for (const path of paths) {
		const lower = path.toLowerCase();
		// Already written out in full: nothing left to pick.
		if (lower === typed) {
			continue;
		}
		const [, name] = split(lower);
		const score =
			name.startsWith(typed.split("/").at(-1) ?? "") && lower.includes(typed)
				? 0
				: lower.includes(typed)
					? 1
					: inOrder(lower, typed)
						? 2
						: null;
		if (score !== null) {
			scored.push({
				path,
				score,
				depth: path.replace(/\/$/, "").split("/").length,
			});
		}
	}
	return scored
		.sort(
			(left, right) =>
				left.score - right.score ||
				left.depth - right.depth ||
				// Directories first, the way a file browser lists them.
				Number(!left.path.endsWith("/")) - Number(!right.path.endsWith("/")) ||
				left.path.localeCompare(right.path),
		)
		.map(({ path }) => path);
}

/** A path as its folder and its own name, a directory's with its `/`. */
function split(path: string): [string, string] {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const cut = trimmed.lastIndexOf("/");
	return [
		trimmed.slice(0, cut + 1),
		trimmed.slice(cut + 1) + (path.endsWith("/") ? "/" : ""),
	];
}

function inOrder(text: string, letters: string): boolean {
	let at = 0;
	for (const letter of letters) {
		at = text.indexOf(letter, at) + 1;
		if (at === 0) {
			return false;
		}
	}
	return true;
}

/** Holds a text box and the list that floats over it. */
export function MentionAnchor({
	mentions,
	children,
}: {
	mentions: { menu: JSX.Element | null };
	children: JSX.Element;
}): JSX.Element {
	return (
		<div className="relative">
			{children}
			{mentions.menu}
		</div>
	);
}
