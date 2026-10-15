import type {
	DictatedTake,
	DictationDecision,
	DictationEdit,
	EditKind,
} from "webappwiz/dictate";

/** One edit to a take's text, made or only suggested, that the person can flip. */
export interface Mark {
	kind: EditKind;
	/** The words as said. */
	original: string;
	/** The words once the edit is made, empty for a deletion. */
	edited: string;
	/** Whether the cleanup was only fairly sure, so it left this for the person. */
	suggested: boolean;
	/** Whether the edit is in the text now. */
	on: boolean;
	/** Whether the mark only points at the words, so there is nothing to flip. */
	flag: boolean;
	/** Where the mark sits in the take's cleaned text. */
	start: number;
	end: number;
}

/**
 * A finished take open to review: the cleaned text with each edit a
 * cleanup made marked, each a tap from undone, and each it only suggested a
 * tap from made. Flipping a mark returns a new review, so the page can show
 * the text it leaves.
 */
export class TakeReview {
	private constructor(
		private readonly base: string,
		/** The text as said. */
		readonly said: string,
		readonly marks: readonly Mark[],
		/** What each cleanup asked its model and what it cost. */
		readonly decisions: readonly DictationDecision[],
	) {}

	/** The review of `take`, or nothing when no cleanup changed or suggested a thing. */
	static of(take: DictatedTake): TakeReview | undefined {
		const found: Mark[] = [
			...take.applied.map((edit) => ({
				kind: edit.type,
				original: edit.was,
				edited: take.text.slice(edit.start, edit.end),
				suggested: false,
				on: true,
				flag: false,
				start: edit.start,
				end: edit.end,
			})),
			...take.edits.map((edit) => ({
				kind: edit.type,
				original: take.text.slice(edit.start, edit.end),
				edited: replacement(edit, take.text),
				suggested: true,
				on: false,
				flag: edit.type === "missing",
				start: edit.start,
				end: edit.end,
			})),
		]
			.filter((mark) => mark.start <= mark.end && mark.end <= take.text.length)
			.sort((one, other) => one.start - other.start);
		// Two edits over the same words cannot both show: the first stays.
		const marks: Mark[] = [];
		for (const mark of found.filter((each) => !each.flag)) {
			if (mark.start >= (marks.at(-1)?.end ?? 0)) {
				marks.push(mark);
			}
		}
		// A flag sits on the words no edit covers, since it spans a whole
		// sentence that edits may fall in.
		for (const mark of found.filter((each) => each.flag)) {
			marks.push(...uncovered(take.text, mark, marks));
		}
		marks.sort((one, other) => one.start - other.start);
		return marks.length === 0
			? undefined
			: new TakeReview(take.text, take.said, marks, take.decisions);
	}

	/** The text with each mark that is on made and each that is off as said. */
	text(): string {
		let out = "";
		let from = 0;
		for (const mark of this.marks) {
			out += this.base.slice(from, mark.start);
			out += mark.on ? mark.edited : mark.original;
			from = mark.end;
		}
		return out + this.base.slice(from);
	}

	/** The cleaned text cut at its marks, in order, for showing each where it sits. */
	parts(): (string | { mark: Mark; index: number })[] {
		const parts: (string | { mark: Mark; index: number })[] = [];
		let from = 0;
		this.marks.forEach((mark, index) => {
			if (mark.start > from) {
				parts.push(this.base.slice(from, mark.start));
			}
			parts.push({ mark, index });
			from = mark.end;
		});
		if (from < this.base.length) {
			parts.push(this.base.slice(from));
		}
		return parts;
	}

	/** The review with mark `index` flipped. */
	toggled(index: number): TakeReview {
		return this.with((mark, at) =>
			at === index && !mark.flag ? !mark.on : mark.on,
		);
	}

	/** Every edit undone, back to the words as said. */
	undoneAll(): TakeReview {
		return this.with(() => false);
	}

	/** Every sure edit made and every suggestion left, as the take came. */
	asCleaned(): TakeReview {
		return this.with((mark) => !mark.suggested);
	}

	/** Whether every mark is where {@link asCleaned} puts it. */
	get isCleaned(): boolean {
		return this.marks.every((mark) => mark.flag || mark.on !== mark.suggested);
	}

	/** Whether no edit is in the text. */
	get isAsSaid(): boolean {
		return this.marks.every((mark) => !mark.on);
	}

	private with(on: (mark: Mark, index: number) => boolean): TakeReview {
		return new TakeReview(
			this.base,
			this.said,
			this.marks.map((mark, index) => ({ ...mark, on: on(mark, index) })),
			this.decisions,
		);
	}
}

/** What `edit` would put where its words are, the words themselves for a flag. */
function replacement(edit: DictationEdit, text: string): string {
	switch (edit.type) {
		case "tag":
			return `#${edit.system}`;
		case "missing":
			return text.slice(edit.start, edit.end);
		default:
			return edit.text;
	}
}

/** The pieces of `flag` that no mark in `marks` covers, each a flag of its own. */
function uncovered(text: string, flag: Mark, marks: readonly Mark[]): Mark[] {
	const pieces: Mark[] = [];
	let from = flag.start;
	const piece = (start: number, end: number) => {
		const words = text.slice(start, end);
		if (words.trim() !== "") {
			pieces.push({ ...flag, original: words, edited: words, start, end });
		}
	};
	for (const mark of marks.filter(
		(each) => each.end > flag.start && each.start < flag.end,
	)) {
		piece(from, Math.max(from, mark.start));
		from = Math.max(from, mark.end);
	}
	piece(from, Math.max(from, flag.end));
	return pieces;
}
