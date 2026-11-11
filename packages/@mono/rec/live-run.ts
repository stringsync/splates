import { LiveSignals } from "./live-signals";
import { LiveSpeech } from "./live-speech";
import type { ToControl } from "./protocol";
import type { RecorderDeps, Run } from "./run";
import type { LogEntries } from "./sinks";
import { SpeechPanel } from "./speech-panel";

export interface LiveRunOptions {
	run: Run;
	say: (message: ToControl) => void;
	deps: RecorderDeps;
	liveKey?: string;
}

/** What a run shows the control panel while it records: signal rows and, with a key and a mic, live speech. */
export class LiveRun implements LogEntries {
	private readonly signals: LiveSignals;

	constructor(opts: LiveRunOptions) {
		const { run, say, deps, liveKey } = opts;
		this.signals = new LiveSignals(
			{ frameAt: (at) => run.pointer?.frameAt(at) },
			{ row: (row) => say({ type: "signal", ...row }) },
		);
		run.live = this.signals;
		if (liveKey && run.started.mic !== undefined) {
			run.speech = new LiveSpeech({
				key: liveKey,
				clock: deps.wall,
				listener: new SpeechPanel({ say }, deps.log, deps.wall),
			});
		}
	}

	event(...args: Parameters<LiveSignals["event"]>): void {
		this.signals.event(...args);
	}

	entry(...args: Parameters<LiveSignals["log"]>): void {
		this.signals.log(...args);
	}
}
