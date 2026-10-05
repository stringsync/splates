import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { FileIcon, FolderIcon } from "lucide-react";
import {
	type ChangeEvent,
	type JSX,
	type KeyboardEvent,
	useEffect,
	useRef,
} from "react";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
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

/** The edges of a box on the screen, in pixels from the top. */
interface Edges {
	top: number;
	bottom: number;
}

export type MentionsEvents = { changed: undefined };

/**
 * A text box's words, and the files and directories an `@` in them can point
 * an agent at: a list of the tree's paths, filtered as you type, and the path
 * written in place of what was typed. Read it through `useMentions`, which
 * wires it to a box.
 *
 * `load` fetches the paths, once, when the box first shows, so there is
 * nothing to wait for at the `@`.
 */
export class Mentions implements Eventful<MentionsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<MentionsEvents>();
	readonly events = this.dispatcher.events;

	/** The paths that match the `@` the caret is in, best first. */
	matches: string[] = [];
	place: Place = { below: false, room: SHOWN * ROW };

	private all: string[] = [];
	private caret = 0;
	private chosen = 0;
	// Where Escape closed the list, so it stays closed until another `@`.
	private dismissed: number | null = null;
	// Bumped by `dispose`, so a load it outlived lands nowhere.
	private loads = 0;

	constructor(
		/** Whose tree to list; empty for the main tree. */
		private readonly task: string,
		/** The box's words. */
		public text = "",
	) {}

	/** Whether the list shows. */
	get open(): boolean {
		return this.matches.length > 0;
	}

	/** The index of the match Enter would write. */
	get active(): number {
		return Math.min(this.chosen, this.matches.length - 1);
	}

	load(): void {
		const load = ++this.loads;
		fetchPaths(this.task).then(
			(found) => {
				if (load === this.loads) {
					this.all = found;
					this.update();
				}
			},
			// Without the list, `@` is only a character: nothing else breaks.
			() => undefined,
		);
	}

	dispose(): void {
		this.loads++;
	}

	/** New words in the box, with the caret where it now is. */
	write(text: string, caret = text.length): void {
		this.text = text;
		this.caret = caret;
		this.update();
	}

	/** The caret moved without the words changing. */
	track(caret: number): void {
		this.caret = caret;
		this.update();
	}

	/**
	 * Steps the active match `by` rows, wrapping at either end; false when no
	 * list is open to step through.
	 */
	move(by: number): boolean {
		if (!this.open) {
			return false;
		}
		this.chosen =
			(this.active + by + this.matches.length) % this.matches.length;
		this.update();
		return true;
	}

	hover(index: number): void {
		this.chosen = index;
		this.update();
	}

	/** Closes the list until another `@`; false when none was open. */
	dismiss(): boolean {
		const mention = this.mention();
		if (!this.open || mention === null) {
			return false;
		}
		this.dismissed = mention.start;
		this.update();
		return true;
	}

	/**
	 * Writes `path` in place of the `@` being typed, and gives where the caret
	 * belongs after it; null when no `@` is being typed. Writes the active
	 * match when no path is given.
	 */
	insert(path = this.matches[this.active] ?? ""): number | null {
		const mention = this.mention();
		if (mention === null) {
			return null;
		}
		const end = mention.start + 1 + mention.query.length;
		// A directory keeps the list open on what is inside it; a file is done.
		const written = `@${path}${path.endsWith("/") ? "" : " "}`;
		const after = mention.start + written.length;
		this.write(
			this.text.slice(0, mention.start) + written + this.text.slice(end),
			after,
		);
		return after;
	}

	/**
	 * Picks the side the list opens on, from where the box sits within the
	 * frame that clips it, as the list opens rather than while it filters, so
	 * it stays put.
	 */
	placeIn(box: Edges, frame: Edges): void {
		const above = box.top - frame.top;
		const under = frame.bottom - box.bottom;
		const full = SHOWN * ROW + 10;
		// Above by choice, where a phone's keyboard cannot cover it; below
		// only when that has more room.
		const below = above < full && under > above;
		this.place = { below, room: Math.min(full, (below ? under : above) - 8) };
		this.dispatcher.dispatch("changed");
	}

	private mention(): Mention | null {
		return typedAt(this.text, this.caret);
	}

	private update(): void {
		const mention = this.mention();
		const wasOpen = this.open;
		this.matches =
			mention === null || mention.start === this.dismissed
				? []
				: rank(this.all, mention.query).slice(0, SHOWN);
		if (!wasOpen && this.open) {
			this.chosen = 0;
		}
		this.dispatcher.dispatch("changed");
	}
}

/**
 * Wires `mentions` to a text box: spread the handlers onto the box, give it
 * `value` as its value, and hold both it and `menu` in a `MentionAnchor`. The
 * list floats over the page, above the box or below it when there is no room
 * above, so nothing around it moves.
 */
export function useMentions<Box extends HTMLInputElement | HTMLTextAreaElement>(
	mentions: Mentions,
) {
	const ref = useRef<Box>(null);
	const { value, matches, active, place } = useReactive(
		mentions,
		(mentions) => ({
			value: mentions.text,
			matches: mentions.matches,
			active: mentions.active,
			place: mentions.place,
		}),
		["changed"],
	);
	const open = matches.length > 0;

	useDisposerEffect(
		(disposer) => {
			mentions.load();
			disposer.use(mentions);
		},
		[mentions],
	);

	useEffect(() => {
		if (!open || ref.current === null) {
			return;
		}
		// A dialog the box sits in clips anything past its edges, and the window
		// clips the rest.
		const frame = ref.current
			.closest("[data-slot=dialog-content]")
			?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
		mentions.placeIn(ref.current.getBoundingClientRect(), {
			top: frame.top,
			bottom: Math.min(frame.bottom, innerHeight),
		});
	}, [open, mentions]);

	const focusAt = (caret: number | null) => {
		if (caret === null) {
			return;
		}
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(caret, caret);
		});
	};
	const track = () => mentions.track(ref.current?.selectionStart ?? 0);

	return {
		ref,
		value,
		onChange: (event: ChangeEvent<Box>) =>
			mentions.write(
				event.target.value,
				event.target.selectionStart ?? event.target.value.length,
			),
		onSelect: track,
		onClick: track,
		/** Handles the keys the list takes while open; true when it took one. */
		onKeyDown: (event: KeyboardEvent<Box>): boolean => {
			if (!open) {
				return false;
			}
			const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
			if (move !== undefined) {
				mentions.move(move);
			} else if (event.key === "Enter" || event.key === "Tab") {
				focusAt(mentions.insert());
			} else if (event.key === "Escape") {
				mentions.dismiss();
			} else {
				return false;
			}
			event.preventDefault();
			// Escape would otherwise close the dialog as well as the list.
			event.stopPropagation();
			return true;
		},
		menu: open ? (
			<Menu
				matches={matches}
				active={active}
				place={place}
				onPick={(path) => focusAt(mentions.insert(path))}
				onHover={(index) => mentions.hover(index)}
			/>
		) : null,
	};
}

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
