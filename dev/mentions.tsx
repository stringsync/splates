import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { FileIcon, FolderIcon } from "lucide-react";
import {
	type ChangeEvent,
	type JSX,
	type KeyboardEvent,
	type ReactNode,
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
export interface Place {
	below: boolean;
	room: number;
}

/** What a reference starts with: `@` for a path, `#` for the rest. */
export type Sign = "@" | "#";

/** An `@` or `#` being typed: its sign, where it starts, and what follows it so far. */
interface Mention {
	sign: Sign;
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
 * A text box's words, and what an `@` or `#` in them can point an agent at,
 * as its `sources` offer: a list filtered as you type, and the pick written
 * in place of what was typed. Read it through `useMentions`, which wires it
 * to a box.
 *
 * `load` fetches what the sources search, once, when the box first shows, so
 * there is nothing to wait for at the sign.
 */
export class Mentions implements Eventful<MentionsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<MentionsEvents>();
	readonly events = this.dispatcher.events;

	/** What matches the `@` or `#` the caret is in, best first. */
	matches: Pick[] = [];
	/** The sign of the list that shows. */
	sign: Sign = "@";
	place: Place = { below: false, room: SHOWN * ROW };

	private caret = 0;
	private chosen = 0;
	// Where Escape closed the list, so it stays closed until another `@`.
	private dismissed: number | null = null;
	// Bumped by `dispose`, so a load it outlived lands nowhere.
	private loads = 0;

	constructor(
		private readonly sources: Sources,
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
		for (const source of Object.values(this.sources)) {
			source.load?.().then(
				() => load === this.loads && this.update(),
				// Without the list, the sign is only a character: nothing else breaks.
				() => undefined,
			);
		}
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

	/** Closes the list until another sign; false when none was open. */
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
	 * Writes `pick` in place of the sign being typed, and gives where the
	 * caret belongs after it; null when no sign is being typed, or nothing
	 * matches. Writes the active match when no pick is given.
	 */
	insert(pick = this.matches[this.active]): number | null {
		const mention = this.mention();
		if (mention === null || pick === undefined) {
			return null;
		}
		const end = mention.start + 1 + mention.query.length;
		const { written } = pick;
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
		const mention = typedAt(this.text, this.caret);
		return mention !== null && this.sources[mention.sign] !== undefined
			? mention
			: null;
	}

	private update(): void {
		const mention = this.mention();
		const wasOpen = this.open;
		this.matches =
			mention === null || mention.start === this.dismissed
				? []
				: (this.sources[mention.sign]?.search(mention.query) ?? []).slice(
						0,
						SHOWN,
					);
		this.sign = mention?.sign ?? this.sign;
		if (!wasOpen && this.open) {
			this.chosen = 0;
		}
		this.dispatcher.dispatch("changed");
	}
}

/** One row of the list: what it shows, and what picking it writes. */
export interface Pick {
	id: string;
	label: string;
	/** Beside the label, giving way first, such as a path's folder. */
	description?: string | undefined;
	icon: ReactNode;
	/**
	 * Written in place of the sign and what was typed after it. One that
	 * ends in a space is done; one that does not keeps the list open on
	 * what it now starts, as a directory does on what is inside it.
	 */
	written: string;
}

/** What a sign offers: the rows that match what was typed after it, best first. */
export interface Source {
	search(query: string): Pick[];
	/** Fetches what it searches, once, when the box first shows. */
	load?(): Promise<void>;
}

/** Each sign the box takes, and what it offers. */
export type Sources = Partial<Record<Sign, Source>>;

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
	const { value, matches, active, place, sign } = useReactive(
		mentions,
		(mentions) => ({
			value: mentions.text,
			matches: mentions.matches,
			active: mentions.active,
			place: mentions.place,
			sign: mentions.sign,
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
		if (open && ref.current !== null) {
			placeList(mentions, ref.current);
		}
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
			<MentionMenu
				label={sign === "@" ? "files" : "references"}
				matches={matches}
				active={active}
				place={place}
				onPick={(pick) => focusAt(mentions.insert(pick))}
				onHover={(index) => mentions.hover(index)}
			/>
		) : null,
	};
}

/** Opens the list of `mentions` on the side of `box` with room for it. */
export function placeList(mentions: Mentions, box: Element): void {
	// A dialog the box sits in clips anything past its edges, and the window
	// clips the rest.
	const frame = box
		.closest("[data-slot=dialog-content]")
		?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
	mentions.placeIn(box.getBoundingClientRect(), {
		top: frame.top,
		bottom: Math.min(frame.bottom, innerHeight),
	});
}

/** The list of what matches the sign being typed, floating over its box. */
export function MentionMenu({
	label,
	matches,
	active,
	place,
	onPick,
	onHover,
}: {
	label: string;
	matches: Pick[];
	active: number;
	place: Place;
	onPick: (pick: Pick) => void;
	onHover: (index: number) => void;
}): JSX.Element {
	return (
		<div
			role="listbox"
			aria-label={label}
			style={{ maxHeight: place.room }}
			className={cn(
				"absolute inset-x-0 z-50 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
				place.below ? "top-full mt-1" : "bottom-full mb-1",
			)}
		>
			{matches.map((pick, index) => {
				return (
					<div
						key={pick.id}
						role="option"
						tabIndex={-1}
						aria-selected={index === active}
						// Down, not click, so the box keeps its focus and caret.
						onMouseDown={(event) => {
							event.preventDefault();
							onPick(pick);
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
							"flex cursor-default items-center gap-2 rounded-md px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
							index === active && "bg-muted",
						)}
					>
						{pick.icon}
						<span className="truncate">{pick.label}</span>
						{/* Gives way first, so the label keeps as much as it can. */}
						<span className="shrink-1000 truncate text-muted-foreground text-xs">
							{pick.description}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** The `@` or `#` the caret is in, if any: one at the start or after a space. */
export function typedAt(text: string, caret: number): Mention | null {
	const found = /(^|\s)([@#])([^\s@#]*)$/.exec(text.slice(0, caret));
	if (found === null) {
		return null;
	}
	const sign = found[2] === "#" ? "#" : "@";
	const query = found[3] ?? "";
	return { sign, start: caret - query.length - 1, query };
}

/**
 * The tree `task` runs in's files and directories for `@`, fetched as the
 * box first shows; empty for the main tree.
 */
export function treePaths(task: string): Source {
	let all: string[] = [];
	return {
		load: () =>
			fetchPaths(task).then((found) => {
				all = found;
			}),
		search: (query) => pathPicks(rank(all, query)),
	};
}

/** Paths as the `@` list shows them, a directory's keeping it open. */
export function pathPicks(paths: readonly string[]): Pick[] {
	return paths.map((path) => {
		const directory = path.endsWith("/");
		const Icon = directory ? FolderIcon : FileIcon;
		const [folder, name] = split(path);
		return {
			id: path,
			label: name,
			description: folder,
			icon: <Icon />,
			written: `@${path}${directory ? "" : " "}`,
		};
	});
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
export function split(path: string): [string, string] {
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
