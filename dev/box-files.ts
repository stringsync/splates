import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Question } from "../plan";
import { type Answer, replyOf } from "../reply";
import { attachmentName, shelfOf } from "./attachment-chips";
import { SEEN } from "./conversation-feed";
import { Files } from "./files";

/** The name of a card's "Anything else" box among its boxes. */
export const MORE = "more";

/**
 * The files attached to each answer box of one card, by the box's name, which
 * go with the card's one reply: each box's are named after its words, as the
 * composer's chips name them, so the agent knows which answer each is for.
 */
export class BoxFiles implements Eventful<{ changed: undefined }>, Resource {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private readonly boxes = new Map<string, Files>();
	private readonly disposer = new Disposer();

	/** The files of the box named `name`. */
	of(name: string): Files {
		let files = this.boxes.get(name);
		if (files === undefined) {
			files = new Files();
			this.boxes.set(name, files);
			this.disposer.defer(
				files.events.on("changed", () => this.dispatcher.dispatch("changed")),
			);
		}
		return files;
	}

	/**
	 * The reply's files, box by box in the order of `texts`, and each box's
	 * text with its files named after it: `[Image 1]` for the reply's first
	 * image, `[File 1]` for its first other file.
	 */
	out(texts: { name: string; text: string }[]): {
		texts: string[];
		files: File[];
	} {
		const counts = { image: 0, file: 0 };
		const files: File[] = [];
		const named = texts.map(({ name, text }) => {
			const own = this.boxes.get(name)?.files ?? [];
			files.push(...own);
			const names = own.map((file) => {
				const shelf = shelfOf(SEEN.includes(file.type) ? "image" : "file");
				const at = counts[shelf];
				counts[shelf] += 1;
				return `[${attachmentName(shelf, at)}]`;
			});
			return [text, ...names].filter((each) => each !== "").join(" ");
		});
		return { texts: named, files };
	}

	/**
	 * The reply to `questions` that `answers` and `more` make, each question's
	 * box under its line, and its files, each named after the answer it goes
	 * with. A box holding only files answers its question.
	 */
	reply(
		questions: Question[],
		answers: (Answer | null)[],
		more: string,
	): { text: string; files: File[] } {
		const { texts, files } = this.out([
			...questions.map((asked, at) => ({
				name: asked.text,
				text: answers[at]?.words ?? "",
			})),
			{ name: MORE, text: more },
		]);
		const named = questions.map((_, at) => {
			const answer = answers[at] ?? null;
			const words = texts[at] ?? "";
			return answer === null && words === ""
				? null
				: { picks: answer?.picks ?? [], words };
		});
		return { text: replyOf(questions, named, texts.at(-1) ?? ""), files };
	}

	/** Whether any box holds a file. */
	get any(): boolean {
		return [...this.boxes.values()].some((each) => each.files.length > 0);
	}

	/** Drops every file, once the reply has gone. */
	clear(): void {
		for (const files of this.boxes.values()) {
			files.clear();
		}
	}

	dispose(): void {
		this.disposer.dispose();
		this.boxes.clear();
		this.dispatcher.dispose();
	}
}
