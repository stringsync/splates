import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Position } from "webappwiz/geometry";
import { imageName } from "./image-chips";

/**
 * One mark: a box between two corners, an arrow from its tail to its head, or
 * a pin at `from`. Its number is its place in the list, shown just off the
 * mark, with its note beside the number until the person drags it to `label`.
 */
export interface Mark {
	kind: "box" | "arrow" | "pin";
	from: Position;
	to: Position;
	note: string;
	label?: Position;
}

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

/** The marks' color: vivid magenta, which a screenshot of a UI rarely has. */
const INK = "#ff1f8f";

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
	private held: Hold | null = null;

	constructor(
		/** The image as the person attached it, which the marks go over. */
		readonly original: File,
		/** `original`, decoded. */
		readonly image: ImageBitmap,
		public marks: Mark[] = [],
	) {}

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
	 * for the end of the message, or "" when none has a note.
	 */
	static notesFor(files: readonly File[]): string {
		return files
			.flatMap((file, at) => {
				const notes = numbered(annotated.get(file)?.marks ?? []);
				if (notes.length === 0) {
					return [];
				}
				return [`Marks on [${imageName(at)}]:\n${notes.join("\n")}`];
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
	 * Where mark `at`'s number sits: outside a box by its top corner on the
	 * side with more room, behind an arrow's tail, or just above a pin's spot,
	 * never off the image. Dragging its note leaves it there.
	 */
	anchor(at: number): Position {
		const mark = this.marks[at];
		if (mark === undefined) {
			return Position.origin();
		}
		return this.onImage(this.spot(mark));
	}

	/** Where mark `at`'s note sits beside: where the person dragged it, or its number. */
	label(at: number): Position {
		const label = this.marks[at]?.label;
		return label === undefined ? this.anchor(at) : this.onImage(label);
	}

	/**
	 * Which side of `label(at)` mark `at`'s note goes: away from the mark, so
	 * it covers none of it, unless the image all but ends that way.
	 */
	side(at: number): "left" | "right" {
		const mark = this.marks[at];
		if (mark === undefined) {
			return "right";
		}
		const { x } = this.label(at);
		const middle = (mark.from.x + mark.to.x) / 2;
		const away =
			x < middle || (x === middle && x > this.width * 0.6) ? "left" : "right";
		const room = away === "left" ? x : this.width - x;
		if (room < this.width / 4 && room < this.width - room) {
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
	 * opens its note; anywhere else, starts a new mark there.
	 */
	press(point: Position, slop = 0): void {
		const hit = this.markAt(point, slop);
		if (hit !== null) {
			this.set({ selected: hit, draft: null });
			return;
		}
		this.set({
			selected: null,
			draft: { kind: this.tool, from: point, to: point, note: "" },
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
			this.set({ draft: { ...this.draft, to: point } });
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
				each === at ? { ...mark, label: this.onImage(label) } : mark,
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

	/** Draws the image, then its marks and the one being dragged out, at full size. */
	draw(context: CanvasRenderingContext2D): void {
		context.clearRect(0, 0, this.width, this.height);
		context.drawImage(this.image, 0, 0);
		context.save();
		context.lineCap = "round";
		context.lineJoin = "round";
		const all = this.draft === null ? this.marks : [...this.marks, this.draft];
		all.forEach((mark, at) => {
			this.line(context, mark, at);
			if (mark !== this.draft) {
				this.number(context, at);
			}
		});
		context.restore();
	}

	/**
	 * The image with its marks drawn in, as a PNG named for the original, or
	 * the original itself when there are none.
	 */
	async flatten(): Promise<File> {
		if (this.marks.length === 0) {
			return this.original;
		}
		const canvas = document.createElement("canvas");
		canvas.width = this.width;
		canvas.height = this.height;
		const context = canvas.getContext("2d");
		if (context === null) {
			throw new Error("this browser cannot draw the marks");
		}
		this.set({ selected: null, draft: null });
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
	private onImage(spot: Position): Position {
		const edge = this.badge + this.stroke;
		return new Position(
			Math.min(Math.max(spot.x, edge), this.width - edge),
			Math.min(Math.max(spot.y, edge), this.height - edge),
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

	/**
	 * Mark `at`'s line: a box's edges, an arrow, or the stem from a pin's
	 * number down to a ring on its spot. A dark shadow, then a white halo,
	 * then the ink: it reads on any background, light, dark or busy.
	 */
	private line(
		context: CanvasRenderingContext2D,
		mark: Mark,
		at: number,
	): void {
		const { from, to } = mark;
		const path = new Path2D();
		if (mark.kind === "box") {
			path.rect(
				Math.min(from.x, to.x),
				Math.min(from.y, to.y),
				Math.abs(to.x - from.x),
				Math.abs(to.y - from.y),
			);
		} else if (mark.kind === "arrow") {
			const angle = Math.atan2(to.y - from.y, to.x - from.x);
			const head = this.stroke * 4;
			path.moveTo(from.x, from.y);
			path.lineTo(to.x, to.y);
			for (const side of [-1, 1]) {
				path.moveTo(to.x, to.y);
				path.lineTo(
					to.x - head * Math.cos(angle + side * 0.5),
					to.y - head * Math.sin(angle + side * 0.5),
				);
			}
		} else {
			const anchor = this.anchor(at);
			path.moveTo(anchor.x, anchor.y);
			path.lineTo(from.x, from.y);
			// A ring on the spot itself, so the stem plainly ends somewhere.
			path.moveTo(from.x + this.stroke, from.y);
			path.arc(from.x, from.y, this.stroke, 0, Math.PI * 2);
		}
		context.shadowColor = "rgba(0, 0, 0, 0.55)";
		context.shadowBlur = this.stroke * 1.5;
		context.strokeStyle = "white";
		context.lineWidth = this.stroke * 2;
		context.stroke(path);
		context.shadowColor = "transparent";
		context.strokeStyle = INK;
		context.lineWidth = this.stroke;
		context.stroke(path);
	}

	/** Mark `at`'s number in a ringed disc, at its anchor. */
	private number(context: CanvasRenderingContext2D, at: number): void {
		const { x, y } = this.anchor(at);
		const radius = this.badge;
		context.shadowColor = "rgba(0, 0, 0, 0.55)";
		context.shadowBlur = this.stroke * 1.5;
		context.fillStyle = "white";
		context.beginPath();
		context.arc(x, y, radius + this.stroke * 0.6, 0, Math.PI * 2);
		context.fill();
		context.shadowColor = "transparent";
		context.fillStyle = at === this.selected ? "#c2006a" : INK;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "white";
		context.font = `700 ${Math.round(radius * 1.15)}px system-ui, sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(String(at + 1), x, y + radius * 0.06);
	}

	private set(
		next: Partial<Pick<Annotation, "marks" | "tool" | "selected" | "draft">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

/** Each of `marks`' notes, numbered as its mark is: "1. Too much padding". */
function numbered(marks: readonly Mark[]): string[] {
	return marks.flatMap((mark, at) =>
		mark.note.trim() === "" ? [] : [`${at + 1}. ${mark.note.trim()}`],
	);
}

function distance(start: Position, end: Position): number {
	return Math.hypot(end.x - start.x, end.y - start.y);
}

/** The straight pieces a box's edges or an arrow's shaft are made of. */
function outline(mark: Mark): [Position, Position][] {
	const { from, to } = mark;
	if (mark.kind !== "box") {
		return [[from, to]];
	}
	const corners = [
		from,
		new Position(to.x, from.y),
		to,
		new Position(from.x, to.y),
	];
	return corners.map((corner, each) => [
		corner,
		corners[(each + 1) % 4] as Position,
	]);
}

/** How far `point` is from the nearest spot on the line from `start` to `end`. */
function toSegment(point: Position, start: Position, end: Position): number {
	const length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
	if (length === 0) {
		return distance(point, start);
	}
	const along = Math.min(
		1,
		Math.max(
			0,
			((point.x - start.x) * (end.x - start.x) +
				(point.y - start.y) * (end.y - start.y)) /
				length,
		),
	);
	return distance(
		point,
		new Position(
			start.x + along * (end.x - start.x),
			start.y + along * (end.y - start.y),
		),
	);
}
