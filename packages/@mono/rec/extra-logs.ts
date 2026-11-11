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
	/** Called with a problem that does not stop the recording. */
	onNote?: (text: string) => void;
	/** Each `--tail` value. */
	tails: string[];
	/** Called with each scrubbed line and the file it goes to. */
	onEntry?: (file: string, line: string) => void;
}

/** What `--docker` and `--tail` follow, each into a file under `logs/`, scrubbed. */
export class ExtraLogs implements Resource {
	private readonly disposer = new Disposer();
	/** The files written, by source name. */
	readonly files: Record<string, string> = {};

	private constructor(private readonly writer: LogWriter) {}

	static async start(options: ExtraLogsOptions): Promise<ExtraLogs> {
		await options.fs.mkdir(`${options.dir}/logs`, { recursive: true });
		const extra = new ExtraLogs(
			new LogWriter(options.fs, options.dir, options.scrubber, options.onEntry),
		);
		try {
			await extra.open(options);
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

	private sink(
		_options: ExtraLogsOptions,
		name: string,
		file: string,
	): (at: number, text: string) => void {
		this.files[name] = file;
		return (at, text) => {
			this.writer.append(file, sourceLine(at, text));
		};
	}

	private async open(options: ExtraLogsOptions): Promise<void> {
		if (options.docker !== undefined) {
			// Docker being down, or a named container not running, must not stop the recording.
			let containers: Container[] = [];
			try {
				containers = selectContainers(
					await listContainers(options.ps),
					options.docker,
					options.ps.cwd(),
				);
			} catch (error) {
				options.onNote?.(`docker logs: ${(error as Error).message}`);
			}
			for (const container of containers) {
				const name = `docker:${container.name}`;
				this.disposer.use(
					followContainer({
						ps: options.ps,
						container,
						now: options.now,
						onLine: this.sink(
							options,
							name,
							`logs/docker-${fileSafe(container.name)}.log`,
						),
					}),
				);
			}
		}
		const used = new Set<string>();
		for (const value of options.tails) {
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
					now: options.now,
					onLine: this.sink(options, `tail:${spec.path}`, file),
				}),
			);
		}
	}
}
