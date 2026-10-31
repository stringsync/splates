import { Dispatcher } from "core/events";
import type { Duration } from "core/time";
import type { Cue } from "./cue";
import {
	type AudioSink,
	type MicPermission,
	type Microphone,
	type Recording,
	type RecordingEvents,
	TICK,
} from "./microphone";

/** Says `said` as each take starts, and more on `speak`, unless a test makes it fail. */
export class FakeMicrophone implements Microphone {
	said = "something";
	/** Set to make the next start fail with it, as a denied mic does. */
	failure: Error | undefined;
	/** What `permission` answers. */
	allowed: MicPermission = "granted";
	/** Whether the last take still holds the mic. */
	open = false;
	/** The cues the last take played, in order. */
	cues: Cue[] = [];
	private sink: AudioSink | undefined;
	private dispatcher: Dispatcher<RecordingEvents> | undefined;

	async permission(): Promise<MicPermission> {
		return this.allowed;
	}

	async start(sink: AudioSink): Promise<Recording> {
		if (this.failure !== undefined) {
			throw this.failure;
		}
		const dispatcher = new Dispatcher<RecordingEvents>();
		this.open = true;
		this.cues = [];
		this.sink = sink;
		this.dispatcher = dispatcher;
		// After the start resolves, as a real mic's first audio comes.
		setTimeout(() => this.speak(this.said));
		return {
			events: dispatcher.events,
			cue: (cue) => {
				this.cues.push(cue);
			},
			dispose: () => {
				this.open = false;
				this.sink = undefined;
				this.dispatcher = undefined;
				dispatcher.dispose();
			},
		};
	}

	/** Says `text` into the take under way, as its bytes, at a speaking level. */
	speak(text: string): void {
		this.sink?.send(new TextEncoder().encode(text));
		this.tick(0.5);
	}

	/** Ticks once, as a real mic does each `TICK`. */
	tick(level: number | null): void {
		this.dispatcher?.dispatch("tick", level);
	}

	/** Ticks at `level` for as long as `span`. */
	hold(level: number | null, span: Duration): void {
		for (let i = 0; i < span.ms / TICK.ms; i++) {
			this.tick(level);
		}
	}

	/** Stops hearing, as a call or a hidden page makes a phone do. */
	interrupt(why: string): void {
		this.dispatcher?.dispatch("interrupted", why);
	}
}
