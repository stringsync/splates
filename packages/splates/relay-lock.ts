import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Lock, Ps } from "webappwiz/system";
import { Duration, sleep, type Timer } from "webappwiz/time";

/** Who holds a lock, as `FileLock` writes it, so either side reads the other's. */
interface Holder {
	pid: number;
	hostname: string;
	at: string;
}

/**
 * The lock a command on a worker takes on the coordinator's records, where
 * `FileLock` would take one on this machine's disk: either waits for the
 * other, as both keep the same directory and holder. Release it, or let it go
 * stale once the process ends.
 */
export class RelayLock implements Lock {
	// Made, judged and stolen through `fs`, which reaches the coordinator, and
	// its holder's `at` kept fresh while held, since a holder on another host
	// is judged by its age alone. Nothing removes it when the process dies.
	private beat: Resource | null = null;

	constructor(
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			ps: Ps;
			log: Logger;
			timer: Timer;
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
		this.beat = this.deps.timer.setInterval(
			() => void this.stamp().catch(() => {}),
			Duration.ms(stalenessMs / 3),
		);
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		if (this.beat === null) {
			return;
		}
		this.beat.dispose();
		this.beat = null;
		await this.deps.fs.rm(this.path, { recursive: true, force: true });
	}

	async releaseIfOurs(): Promise<void> {
		const { ps } = this.deps;
		const holder = await this.holder();
		if (holder?.pid === ps.pid && holder.hostname === ps.hostname) {
			this.beat ??= { dispose: () => {} };
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
		const { ps, stalenessMs } = this.deps;
		if (holder.hostname === ps.hostname) {
			return !ps.alive(holder.pid);
		}
		return Date.now() - Date.parse(holder.at) > stalenessMs;
	}
}
