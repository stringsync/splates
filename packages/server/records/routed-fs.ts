import type { Resource } from "webappwiz/disposable";
import type {
	Fs,
	MkdirOptions,
	RmOptions,
	StatResult,
	WatchOptions,
} from "webappwiz/system";

/**
 * The local disk, but for the records under `root`, which `remote` reaches
 * on the coordinator: what every class handed an `Fs` reads and writes through on a
 * worker, none of them the wiser.
 */
export class RoutedFs implements Fs {
	constructor(
		private readonly root: string,
		private readonly remote: Fs,
		private readonly local: Fs,
	) {}

	private at(path: string): Fs {
		return path === this.root || path.startsWith(`${this.root}/`)
			? this.remote
			: this.local;
	}

	exists(path: string): Promise<boolean> {
		return this.at(path).exists(path);
	}

	mkdir(path: string, opts?: MkdirOptions): Promise<void> {
		return this.at(path).mkdir(path, opts);
	}

	read(path: string): Promise<string> {
		return this.at(path).read(path);
	}

	write(path: string, data: string): Promise<void> {
		return this.at(path).write(path, data);
	}

	append(path: string, data: string): Promise<void> {
		return this.at(path).append(path, data);
	}

	readBytes(path: string): Promise<Uint8Array> {
		return this.at(path).readBytes(path);
	}

	writeBytes(path: string, data: Uint8Array): Promise<void> {
		return this.at(path).writeBytes(path, data);
	}

	async rename(from: string, to: string): Promise<void> {
		const fs = this.at(from);
		if (fs !== this.at(to)) {
			// A record moved across is a copy then a removal.
			await this.at(to).writeBytes(to, await fs.readBytes(from));
			await fs.rm(from, { force: true });
			return;
		}
		await fs.rename(from, to);
	}

	readdir(path: string): Promise<string[]> {
		return this.at(path).readdir(path);
	}

	stat(path: string): Promise<StatResult> {
		return this.at(path).stat(path);
	}

	rm(path: string, opts?: RmOptions): Promise<void> {
		return this.at(path).rm(path, opts);
	}

	chmod(path: string, mode: number): Promise<void> {
		return this.at(path).chmod(path, mode);
	}

	isSymlink(path: string): Promise<boolean> {
		return this.at(path).isSymlink(path);
	}

	watch(
		path: string,
		onChange: (changed: string) => void,
		opts?: WatchOptions,
	): Resource {
		return this.at(path).watch(path, onChange, opts);
	}
}
