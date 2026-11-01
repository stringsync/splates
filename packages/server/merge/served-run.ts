import type { Logger } from "core/log";
import type { MergeAsk, MergeEnd, MergeLog } from "./served";

/** One merge under way, or ended and not yet read. */
export class Run {
	readonly lines: MergeLog[] = [];
	end: MergeEnd | null = null;
	private readonly heard = new Set<() => void>();

	constructor(readonly ask: MergeAsk) {}

	static ended(
		ask: MergeAsk,
		{ lines, end }: { lines: MergeLog[]; end: MergeEnd },
	): Run {
		const run = new Run(ask);
		run.lines.push(...lines);
		run.end = end;
		return run;
	}

	/** Logs into the run, for its `splates merge` to print. */
	readonly logger: Logger = {
		info: (message, ...rest) => this.say("info", message, rest),
		error: (message, ...rest) => this.say("error", message, rest),
	};

	finish(end: MergeEnd): void {
		this.end = end;
		this.tell();
	}

	/** Resolves once there is a line past `from`, the run ended, or `waitMs` passed. */
	async more(from: number, waitMs: number): Promise<void> {
		if (this.lines.length > from || this.end !== null || waitMs <= 0) {
			return;
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(done, waitMs);
			function done() {
				clearTimeout(timer);
				heard.delete(done);
				resolve();
			}
			const heard = this.heard;
			heard.add(done);
		});
	}

	private say(level: MergeLog["level"], message: unknown, rest: unknown[]) {
		this.lines.push({
			level,
			text: [message, ...rest].map((each) => String(each)).join(" "),
		});
		this.tell();
	}

	private tell(): void {
		for (const each of [...this.heard]) {
			each();
		}
	}
}
