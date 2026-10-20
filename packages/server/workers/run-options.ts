import type { SecretStore } from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's coordinator, a URL for another's, or `unix:<path>`. */
	coordinator: string;
	/** How many tasks it takes at once, or 0 for what the machine has (`machineSlots`). */
	slots: number;
	id: string;
	/** A join token from `splates worker add`, spent to join before dialing; empty when joined already. */
	join?: string;
	/**
	 * Keeps the key `join` answers in memory alone, for a machine that is
	 * destroyed rather than restarted, as one a provider makes, which may
	 * have no system store to keep it in.
	 */
	ephemeral?: boolean;
	log: Logger;
	ps: Ps;
	fs: Fs;
	/**
	 * Keeps the key in `~/.splates/worker.env`, which its user alone may
	 * read, rather than the system's store, for a machine whose store is
	 * locked or missing at boot (`KeyFileStore`).
	 */
	keyFile?: boolean;
	/** Where the worker's key is kept; the device's system store, or the key file, by default. */
	store?: SecretStore;
	send?: typeof fetch;
}
