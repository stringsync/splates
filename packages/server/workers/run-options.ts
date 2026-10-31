import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's server, or `unix:<path>`. */
	coordinator: string;
	id: string;
	log: Logger;
	ps: Ps;
	fs: Fs;
}
