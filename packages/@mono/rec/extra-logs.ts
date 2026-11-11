import { Disposer, type Resource } from "core/disposable";
import type { Fs, Ps } from "core/system";
import {
	type Container,
	followContainer,
	listContainers,
	selectContainers,
} from "./docker";
import { LogWriter } from "./log-writer";
import type { Scrubber } from "./scrub";
import type { LineSink, LogEntries, Notes } from "./sinks";
import { fileSafe, sourceLine } from "./sources";
import { parseTailSpec, Tail } from "./tail";

export interface ExtraLogsOptions {
	ps: Ps;
	fs: Fs;
	/** The session folder; logs go under `logs/` in it. */
	dir: string;
	scrubber: Scrubber;
	now: () => number;
	/** `--docker`'s value: "true" for a bare flag, else ids or names. */
	docker?: string;
	/** Hears a problem that does not stop the recording. */
	notes?: Notes;
	/** Each `--tail` value. */
	tails: string[];
	/** Hears each scrubbed line and the file it goes to. */
	entries?: LogEntries;
}

/** What `--docker` and `--tail` follow, each into a file under `logs/`, scrubbed. */
export class ExtraLogs implements Resource {
	private readonly disposer = new Disposer();
	/** The files written, by source name. */
	readonly files: Record<string, string> = {};

	private constructor(private readonly writer: LogWriter) {}

	static async start(opts: ExtraLogsOptions): Promise<ExtraLogs> {
		await opts.fs.mkdir(`${opts.dir}/logs`, { recursive: true });
		const extra = new ExtraLogs(
			new LogWriter(opts.fs, opts.dir, opts.scrubber, {
				entries: opts.entries,
			}),
		);
		try {
			await extra.open(opts);
		} catch (error) {
			extra.dispose();
			throw error;
		}
		return extra;
	}

	flush(): Promise<void> {
		return this.writer.flush();
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private sink(name: string, file: string): LineSink {
		this.files[name] = file;
		return {
			line: (at, text) => {
				this.writer.append(file, sourceLine(at, text));
			},
		};
	}

	private async open(opts: ExtraLogsOptions): Promise<void> {
		if (opts.docker !== undefined) {
			// Docker being down, or a named container not running, must not stop the recording.
			let containers: Container[] = [];
			try {
				containers = selectContainers(
					await listContainers(opts.ps),
					opts.docker,
					opts.ps.cwd(),
				);
			} catch (error) {
				opts.notes?.note(`docker logs: ${(error as Error).message}`);
			}
			for (const container of containers) {
				const name = `docker:${container.name}`;
				this.disposer.use(
					followContainer({
						ps: opts.ps,
						container,
						now: opts.now,
						observer: this.sink(
							name,
							`logs/docker-${fileSafe(container.name)}.log`,
						),
					}),
				);
			}
		}
		const used = new Set<string>();
		for (const value of opts.tails) {
			const spec = parseTailSpec(value);
			const base = fileSafe(spec.path.split("/").pop() ?? "file");
			let file = `logs/tail-${base}.log`;
			for (let copy = 2; used.has(file); copy++) {
				file = `logs/tail-${base}-${copy}.log`;
			}
			used.add(file);
			this.disposer.use(
				await Tail.start({
					...spec,
					now: opts.now,
					sink: this.sink(`tail:${spec.path}`, file),
				}),
			);
		}
	}
}
