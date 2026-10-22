import { color, type Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import {
	type DirectJobReport,
	type DirectReport,
	type DirectRunnerReport,
	type DirectStatus,
	type ServerOf,
	serverOf,
	statusLine,
} from "../workers";

/** How long the last reports may take to reach the server before `splates run` exits without them. */
const FLUSH_MS = 2000;

/**
 * Where `splates run` says how its runner job stands: a colored line on
 * stderr at each step, apart from the command's own output, and every
 * report sent to `splates server` when one answers, for its Runners page.
 * A server that is down or refuses costs nothing but the page: the job
 * goes on.
 */
export class TerminalStatus implements DirectStatus, AsyncDisposable {
	private readonly pending = new Set<Promise<void>>();

	private constructor(
		private readonly server: ServerOf | null,
		private readonly write: (text: string) => void,
		private readonly colored: boolean,
	) {}

	/** On stderr, colored when it is a terminal, reporting to the server this runs under, if any. */
	static async open(ctx: {
		ps: Ps;
		log: Logger;
		dev?: string;
	}): Promise<TerminalStatus> {
		return new TerminalStatus(
			await serverOf(ctx),
			(text) => void process.stderr.write(text),
			process.stderr.isTTY === true,
		);
	}

	job(report: DirectJobReport, line: string | null): void {
		if (line !== null) {
			statusLine(line, tone(report), this.write, this.colored);
		}
		this.send({ job: report });
	}

	runners(runners: DirectRunnerReport[]): void {
		if (runners.length > 0) {
			this.send({ runners });
		}
	}

	/** Waits a moment for the reports still on their way. */
	async [Symbol.asyncDispose](): Promise<void> {
		await Promise.race([
			Promise.allSettled([...this.pending]),
			Bun.sleep(FLUSH_MS),
		]);
	}

	private send(report: DirectReport): void {
		if (this.server === null) {
			return;
		}
		const sent = this.server
			.send(`${this.server.url}/api/runner-reports`, {
				method: "POST",
				// A write names its own origin, as the server asks of every one.
				headers: {
					"content-type": "application/json",
					origin: this.server.url,
				},
				body: JSON.stringify(report),
				signal: AbortSignal.timeout(FLUSH_MS),
			})
			.then(
				() => {},
				() => {},
			)
			.finally(() => this.pending.delete(sent));
		this.pending.add(sent);
	}
}

/** The color a step is shown in: waiting yellow, under way blue, done green, failed red. */
function tone(report: DirectJobReport): (value: unknown) => string {
	switch (report.phase) {
		case "making":
		case "booting":
		case "waiting":
			return color.yellow;
		case "running":
			return color.green;
		case "done":
			return report.code === 0 ? color.green : color.red;
		case "failed":
			return color.red;
		default:
			return color.blue;
	}
}
