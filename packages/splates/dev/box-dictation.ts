import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Dictation } from "./dictation";
import type { DictationSession } from "./dictation-session";

/** The text of a plain box a take writes in. */
export interface DictatedBox {
	read(): string;
	write(text: string): void;
}

/**
 * The page's dictation written into a plain text box, such as a card's
 * answer: the final transcript goes after what the box holds. A change
 * typed mid-take becomes the text the full transcript is appended to.
 */
export class BoxDictation
	implements Eventful<{ changed: undefined }>, Resource
{
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private session: DictationSession | undefined;
	/** What the box held before the words of the take under way. */
	private before = "";

	constructor(
		readonly dictation: Dictation,
		/** What the take is by, so only this box shows it. */
		readonly by: string,
		private readonly box: DictatedBox,
	) {}

	/** Whether a take of this box's is under way. */
	get taking(): boolean {
		return this.session !== undefined;
	}

	/** Starts a take, on the tap itself, as a phone's mic needs. */
	start(): void {
		this.before = this.box.read();
		const session = this.dictation.listen(this.by);
		this.session = session;
		session.onSpeech(({ transcript }) => {
			if (this.session === session) {
				this.box.write(after(this.before, transcript));
			}
		});
		session.onSpeechEnd(() => {
			if (this.session === session) {
				this.session = undefined;
				this.dispatcher.dispatch("changed");
			}
		});
		this.dispatcher.dispatch("changed");
	}

	/** Stops the take under way, which hands the box its final text. */
	stop(): void {
		void this.session?.stop();
	}

	/** The person typed `text` into the box: mid-take, it is what the rest goes after. */
	typed(text: string): void {
		if (this.session !== undefined) {
			this.before = text;
		}
	}

	/** Lets go of a take still under way, as the box goes. */
	dispose(): void {
		const { session } = this;
		this.session = undefined;
		session?.cancel();
		this.dispatcher.dispose();
	}
}

/** `heard` after `before`, a space between them unless one is there. */
function after(before: string, heard: string): string {
	const words = heard.trimStart();
	if (before === "" || words === "") {
		return before + words;
	}
	return /\s$/.test(before) ? before + words : `${before} ${words}`;
}
