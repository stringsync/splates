import type { Resource } from "webappwiz/disposable";
import type { Fs, MkdirOptions, RmOptions, StatResult } from "webappwiz/system";
import type { StateCall, StateProject, WireStat } from "./repo-state";

/** What `fetch` is used for here, so a test can stand in for it. */
type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * A project's records on the coordinator, reached over HTTP: each call one
 * `POST /api/state` to the `splates server` at `url`, through a worker's
 * relay. Paths are this machine's, under `root`, where the records would be
 * were they here; the coordinator answers for its own.
 */
export class RelayFs implements Fs {
	constructor(
		private readonly url: string,
		private readonly project: StateProject,
		private readonly root: string,
		private readonly send: Send = fetch,
	) {}

	exists(path: string): Promise<boolean> {
		return this.call({
			op: "exists",
			path: this.relative(path),
		}) as Promise<boolean>;
	}

	async mkdir(path: string, opts: MkdirOptions = {}): Promise<void> {
		await this.call({
			op: "mkdir",
			path: this.relative(path),
			recursive: opts.recursive,
		});
	}

	read(path: string): Promise<string> {
		return this.call({
			op: "read",
			path: this.relative(path),
		}) as Promise<string>;
	}

	async write(path: string, data: string): Promise<void> {
		await this.call({ op: "write", path: this.relative(path), data });
	}

	async append(path: string, data: string): Promise<void> {
		await this.call({ op: "append", path: this.relative(path), data });
	}

	async readBytes(path: string): Promise<Uint8Array> {
		const data = (await this.call({
			op: "readBytes",
			path: this.relative(path),
		})) as string;
		return new Uint8Array(Buffer.from(data, "base64"));
	}

	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		await this.call({
			op: "writeBytes",
			path: this.relative(path),
			data: Buffer.from(data).toString("base64"),
		});
	}

	async rename(from: string, to: string): Promise<void> {
		await this.call({
			op: "rename",
			path: this.relative(from),
			to: this.relative(to),
		});
	}

	readdir(path: string): Promise<string[]> {
		return this.call({ op: "readdir", path: this.relative(path) }) as Promise<
			string[]
		>;
	}

	async stat(path: string): Promise<StatResult> {
		const stat = (await this.call({
			op: "stat",
			path: this.relative(path),
		})) as WireStat;
		return {
			isDirectory: () => stat.directory,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
		};
	}

	async rm(path: string, opts: RmOptions = {}): Promise<void> {
		await this.call({
			op: "rm",
			path: this.relative(path),
			recursive: opts.recursive,
			force: opts.force,
		});
	}

	async chmod(path: string, mode: number): Promise<void> {
		await this.call({ op: "chmod", path: this.relative(path), mode });
	}

	isSymlink(path: string): Promise<boolean> {
		return this.call({
			op: "isSymlink",
			path: this.relative(path),
		}) as Promise<boolean>;
	}

	watch(path: string): Resource {
		throw new Error(`${path} is on the coordinator, and cannot be watched`);
	}

	/** Whether `path` is one of the records this reaches. */
	private holds(path: string): boolean {
		return path === this.root || path.startsWith(`${this.root}/`);
	}

	private relative(path: string): string {
		if (!this.holds(path)) {
			throw new Error(`${path} is not under ${this.root}`);
		}
		return path.slice(this.root.length + 1);
	}

	private async call(call: StateCall): Promise<unknown> {
		const response = await this.send(`${this.url}/api/state`, {
			method: "POST",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: this.url },
			body: JSON.stringify({ project: this.project, call }),
		});
		const answer = (await response.json().catch(() => null)) as {
			value?: unknown;
			message?: string;
			missing?: boolean;
		} | null;
		if (answer?.missing === true) {
			throw Object.assign(
				new Error(answer.message ?? `${call.path} is missing`),
				{
					code: "ENOENT",
				},
			);
		}
		if (!response.ok) {
			throw new Error(
				answer?.message ??
					`${this.url} answered ${response.status} to ${call.op} ${call.path}`,
			);
		}
		return answer?.value;
	}
}
