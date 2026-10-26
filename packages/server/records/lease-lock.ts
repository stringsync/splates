import type { Logger } from "webappwiz/log";
import type { Fs, Lock, Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";

/** Who holds a lock, as `FileLock` writes it. */
interface Holder {
	pid: number;
	hostname: string;
	at: string;
}

/**
 * The merge lease: a lock held for as long as its holder's process lives, so
 * a long test run is never judged stale. Release it, or let it go stale once
 * the process ends. The pid alone decides, whatever hostname the holder was
 * written under: every holder runs on this machine, whose name macOS changes
 * with the network. Nothing removes it when the process dies.
 */
export class LeaseLock implements Lock {
	private held = false;

	constructor(
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			ps: Ps;
			log: Logger;
			/** After how long a holder that cannot be read counts as gone. */
			stalenessMs: number;
			pollMs?: number;
		},
	) {}

	async acquire(): Promise<void> {
		const { fs, log, stalenessMs, pollMs = 2000 } = this.deps;
		let unreadableSince: number | null = null;
		let sleepMs = 5;
		for (let waited = false; ; waited = true) {
			try {
				await fs.mkdir(this.path, { recursive: false });
			} catch {
				const holder = await this.holder();
				if (holder === null) {
					unreadableSince ??= Date.now();
				}
				const stale =
					holder === null
						? Date.now() - (unreadableSince ?? Date.now()) > stalenessMs
						: this.isStale(holder);
				if (stale) {
					unreadableSince = null;
					log.error(`stealing stale lock ${this.path}`);
					await fs.rm(this.path, { recursive: true, force: true });
					continue;
				}
				await sleep(Duration.ms(sleepMs));
				sleepMs = Math.min(sleepMs * 2, pollMs);
				continue;
			}
			if (waited) {
				log.error(`acquired ${this.path} after waiting`);
			}
			break;
		}
		await this.stamp();
		this.held = true;
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		if (!this.held) {
			return;
		}
		this.held = false;
		await this.deps.fs.rm(this.path, { recursive: true, force: true });
	}

	async releaseIfOurs(): Promise<void> {
		const { ps } = this.deps;
		const holder = await this.holder();
		if (holder?.pid === ps.pid) {
			this.held = true;
			await this.release();
		}
	}

	private get holderPath(): string {
		return `${this.path}/holder.json`;
	}

	private async stamp(): Promise<void> {
		const { fs, ps } = this.deps;
		await fs.write(
			this.holderPath,
			JSON.stringify({
				pid: ps.pid,
				hostname: ps.hostname,
				at: new Date().toISOString(),
			} satisfies Holder),
		);
	}

	private async holder(): Promise<Holder | null> {
		const raw = await this.deps.fs.read(this.holderPath).catch(() => null);
		try {
			return raw === null ? null : (JSON.parse(raw) as Holder);
		} catch {
			return null;
		}
	}

	private isStale(holder: Holder): boolean {
		return !this.deps.ps.alive(holder.pid);
	}
}
