import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's server, or `unix:<path>`. */
	coordinator: string;
	/** How many tasks it takes at once, or 0 for what the machine has (`machineSlots`). */
	slots: number;
	id: string;
	log: Logger;
	ps: Ps;
	fs: Fs;
}
