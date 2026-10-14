import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Position, Rect } from "webappwiz/geometry";
import {
	around,
	distance,
	type Mark,
	outline,
	toSegment,
} from "./annotation-mark";
import { drawMarks } from "./annotation-painter";
import { attachmentName } from "./attachment-chips";

/** A press on a mark's note, which drags it rather than drawing. */
interface Hold {
	at: number;
	from: Position;
	/** From the press to the note's place, so the note keeps its place under it. */
	offset: Position;
	moved: boolean;
}

/** What a drag draws; a click pins whatever the tool. */
export type Tool = "box" | "arrow";

export type AnnotationEvents = { changed: undefined };

/** Each image the person annotated, by the flattened file sent in its place. */
const annotated = new WeakMap<File, { original: File; marks: Mark[] }>();

/**
 * The marks the person draws on one image, numbered in the order drawn, each
 * with a note, and the image with them drawn in, sent in the original's place.
 * It holds the image decoded until disposed.
 */
export class Annotation implements Eventful<AnnotationEvents>, Resource {
	private readonly dispatcher = new Dispatcher<AnnotationEvents>();
	readonly events = this.dispatcher.events;

	tool: Tool = "box";
	/** The mark whose note is open, by index. */
	selected: number | null = null;
	/** The mark being dragged out, not yet among `marks`. */
	draft: Mark | null = null;
	/**
	 * Where marks, their numbers and notes may go, in the image's pixels: the
	 * image itself until `widen` lets them out around it.
	 */
	area: Rect;
	private held: Hold | null = null;

	constructor(
		/** The image as the person attached it, which the marks go over. */
		readonly original: File,
		/** `original`, decoded. */
		readonly image: ImageBitmap,
		public marks: Mark[] = [],
	) {
		this.area = new Rect(0, 0, image.width, image.height);
	}

	/**
	 * Opens `file` to annotate: one already annotated again from its original,
	 * with its marks, so the person picks up where they left off.
	 */
	static async open(file: File): Promise<Annotation> {
		const before = annotated.get(file);
		const original = before?.original ?? file;
		return new Annotation(
			original,
			await createImageBitmap(original),
			before?.marks,
		);
	}

	/**
	 * What the person wrote about the images in `files`, in the order they go,
	 * for the end of the message, or "" when none has a mark.
	 */
	static notesFor(files: readonly File[]): string {
		return files
			.flatMap((file, at) => {
				const notes = numbered(annotated.get(file)?.marks ?? []);
				if (notes.length === 0) {
					return [];
				}
				return [
					`Marks on [${attachmentName("image", at)}]:\n${notes.join("\n")}`,
				];
			})
			.join("\n\n");
	}

	/** How many marks were drawn on `file`, an image sent in an original's place. */
	static marksOn(file: File | undefined): number {
		return file === undefined ? 0 : (annotated.get(file)?.marks.length ?? 0);
	}

	get width(): number {
		return this.image.width;
	}

	get height(): number {
		return this.image.height;
	}

	/** How thick a mark's line is, in the image's pixels, so it shows at any size. */
	get stroke(): number {
		return Math.max(4, Math.round(Math.max(this.width, this.height) / 220));
	}

	/** How big a mark's number is, in the image's pixels. */
	get badge(): number {
		return Math.max(13, this.stroke * 3);
	}

	/**
	 * The part of `area` the image sent covers: the image, grown to take in
	 * each mark and its number drawn outside it, in whole pixels.
	 */
	get bounds(): Rect {
		const line = this.stroke * 3;
		const disc = this.badge + line;
		const image = new Rect(0, 0, this.width, this.height);
		const all = this.marks.flatMap((mark, at) => {
			const ends = [around(mark.from, line), around(this.anchor(at), disc)];
			if (mark.kind === "box") {
				ends.push(around(mark.to, line));
			} else if (mark.kind === "arrow") {
				ends.push(around(mark.to, line + this.stroke * 4));
			}
			return ends;
		});
		const grown = all.reduce((each, next) => each.union(next), image);
		const fit = grown.intersection(this.area.union(image)) ?? image;
		const left = Math.floor(fit.left);
		const top = Math.floor(fit.top);
		return new Rect(
			left,
			top,
			Math.ceil(fit.right) - left,
			Math.ceil(fit.bottom) - top,
		);
	}

	/**
	 * Lets marks, their numbers and notes go anywhere in `area` rather than
	 * only on the image, such as the space around it on the screen.
	 */
	widen(area: Rect): void {
		this.area = area;
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Where mark `at`'s number sits: outside a box by its top corner on the
	 * side with more room, behind an arrow's tail, or just above a pin's spot,
	 * never outside `area`. Dragging its note leaves it there.
	 */
	anchor(at: number): Position {
		const mark = this.marks[at];
		if (mark === undefined) {
			return Position.origin();
		}
		return this.inArea(this.spot(mark));
	}

	/** Where mark `at`'s note sits beside: where the person dragged it, or its number. */
	label(at: number): Position {
		const label = this.marks[at]?.label;
		return label === undefined ? this.anchor(at) : this.inArea(label);
	}

	/**
	 * Which side of `label(at)` mark `at`'s note goes: away from the mark, so
	 * it covers none of it, unless `area` all but ends that way.
	 */
	side(at: number): "left" | "right" {
		const mark = this.marks[at];
		if (mark === undefined) {
			return "right";
		}
		const { x } = this.label(at);
		const middle = (mark.from.x + mark.to.x) / 2;
		const { left, right, w } = this.area;
		const away =
			x < middle || (x === middle && x > left + w * 0.6) ? "left" : "right";
		const room = away === "left" ? x - left : right - x;
		if (room < w / 4 && room < w - room) {
			return away === "left" ? "right" : "left";
		}
		return away;
	}

	use(tool: Tool): void {
		this.set({ tool });
	}

	/**
	 * The mark under `point`, the topmost first: on its number, or within
	 * `slop` pixels of its line, so a thin line is as easy to pick as a fat one.
	 */
	markAt(point: Position, slop = 0): number | null {
		for (let at = this.marks.length - 1; at >= 0; at--) {
			const anchor = this.anchor(at);
			if (distance(point, anchor) <= this.badge + slop) {
				return at;
			}
			const reach = this.stroke + slop;
			if (
				this.segments(at).some(
					([start, end]) => toSegment(point, start, end) <= reach,
				)
			) {
				return at;
			}
		}
		return null;
	}

	/**
	 * A press at `point`: on a mark's number or line, within `slop` pixels,
	 * opens its note; anywhere else, starts a new mark there, kept in `area`.
	 */
	press(point: Position, slop = 0): void {
		const hit = this.markAt(point, slop);
		if (hit !== null) {
			this.set({ selected: hit, draft: null });
			return;
		}
		this.set({
			selected: null,
			draft: {
				kind: this.tool,
				from: this.within(point),
				to: this.within(point),
				note: "",
			},
		});
	}

	/**
	 * A press at `point` on mark `at`'s note: dragged, it moves the note and
	 * leaves the mark and its number where they are; let go where it was, it
	 * opens the note.
	 */
	hold(at: number, point: Position): void {
		this.held = {
			at,
			from: point,
			offset: this.label(at).relativeTo(point),
			moved: false,
		};
		this.set({ draft: null });
	}

	move(point: Position): void {
		const held = this.held;
		if (held !== null) {
			// A press that wobbles a little is still a click.
			if (held.moved || distance(held.from, point) > this.stroke) {
				held.moved = true;
				this.place(held.at, point.translate(held.offset.x, held.offset.y));
			}
			return;
		}
		if (this.draft !== null) {
			this.set({ draft: { ...this.draft, to: this.within(point) } });
		}
	}

	/**
	 * The press let go: what it drew joins the marks with its note open, a pin
	 * when it barely moved.
	 */
	release(): void {
		const held = this.held;
		if (held !== null) {
			this.held = null;
			if (!held.moved) {
				this.select(held.at);
			}
			return;
		}
		const draft = this.draft;
		if (draft === null) {
			return;
		}
		const far = distance(draft.from, draft.to);
		const mark: Mark =
			far < this.stroke * 3 ? { ...draft, kind: "pin", to: draft.from } : draft;
		this.set({
			marks: [...this.marks, mark],
			selected: this.marks.length,
			draft: null,
		});
	}

	/** Moves mark `at`'s note to sit beside `label`, leaving its number. */
	place(at: number, label: Position): void {
		this.set({
			marks: this.marks.map((mark, each) =>
				each === at ? { ...mark, label: this.inArea(label) } : mark,
			),
		});
	}

	select(at: number | null): void {
		this.set({ selected: at });
	}

	write(at: number, note: string): void {
		this.set({
			marks: this.marks.map((mark, each) =>
				each === at ? { ...mark, note } : mark,
			),
		});
	}

	/** Takes mark `at` away; those after it move up a number. */
	remove(at: number): void {
		this.set({
			marks: this.marks.filter((_, each) => each !== at),
			selected: null,
		});
	}

	/** Takes the last mark away. */
	undo(): void {
		if (this.marks.length > 0) {
			this.remove(this.marks.length - 1);
		}
	}

	clear(): void {
		this.set({ marks: [], selected: null, draft: null });
	}

	/**
	 * Draws the image, then its marks and the one being dragged out, in the
	 * image's pixels: the image's top left corner at `context`'s origin.
	 */
	draw(context: CanvasRenderingContext2D): void {
		drawMarks(context, this);
	}

	/**
	 * The image with its marks drawn in, as a PNG named for the original, or
	 * the original itself when there are none. It grows to `bounds` to take in
	 * marks outside the image, clear around it.
	 */
	async flatten(): Promise<File> {
		if (this.marks.length === 0) {
			return this.original;
		}
		const bounds = this.bounds;
		const canvas = document.createElement("canvas");
		canvas.width = bounds.w;
		canvas.height = bounds.h;
		const context = canvas.getContext("2d");
		if (context === null) {
			throw new Error("this browser cannot draw the marks");
		}
		this.set({ selected: null, draft: null });
		context.translate(-bounds.left, -bounds.top);
		this.draw(context);
		const blob = await new Promise<Blob | null>((done) =>
			canvas.toBlob(done, "image/png"),
		);
		if (blob === null) {
			throw new Error("this browser cannot save the marks");
		}
		const name = this.original.name.replace(/\.[^.]*$/, "") || "image";
		const file = new File([blob], `${name}.png`, { type: "image/png" });
		annotated.set(file, { original: this.original, marks: this.marks });
		return file;
	}

	dispose(): void {
		this.image.close();
	}

	/** Where `mark`'s number goes until the person drags it somewhere. */
	private spot(mark: Mark): Position {
		const { from, to } = mark;
		const off = this.badge + this.stroke * 2;
		if (mark.kind === "pin") {
			return from.translate(0, -this.badge * 1.8);
		}
		if (mark.kind === "arrow") {
			const length = distance(from, to) || 1;
			return from.translate(
				((from.x - to.x) / length) * off,
				((from.y - to.y) / length) * off,
			);
		}
		const left = Math.min(from.x, to.x);
		const right = Math.max(from.x, to.x);
		const top = Math.min(from.y, to.y) + this.badge;
		return left >= this.width - right
			? new Position(left - off, top)
			: new Position(right + off, top);
	}

	/** `spot`, moved in just far enough that a number there shows whole. */
	private inArea(spot: Position): Position {
		return this.within(spot, this.badge + this.stroke);
	}

	/** `point`, moved into `area`, and at least `edge` in from its sides. */
	private within(point: Position, edge = 0): Position {
		const { left, top, right, bottom } = this.area;
		return new Position(
			Math.min(Math.max(point.x, left + edge), right - edge),
			Math.min(Math.max(point.y, top + edge), bottom - edge),
		);
	}

	/** The straight pieces mark `at`'s line is made of, to find it by. */
	private segments(at: number): [Position, Position][] {
		const mark = this.marks[at];
		if (mark === undefined) {
			return [];
		}
		return mark.kind === "pin" ? [[this.anchor(at), mark.from]] : outline(mark);
	}

	private set(
		next: Partial<Pick<Annotation, "marks" | "tool" | "selected" | "draft">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

/**
 * Each of `marks`' notes, numbered as its mark is: "1. Too much padding", or
 * "2. (no note)" for a mark left without one, so every mark drawn is named.
 */
export function numbered(marks: readonly Mark[]): string[] {
	return marks.map(
		(mark, at) => `${at + 1}. ${mark.note.trim() || "(no note)"}`,
	);
}
