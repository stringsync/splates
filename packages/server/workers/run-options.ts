import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's server, or `unix:<path>`. */
	coordinator: string;
	id: string;
	log: Logger;
	ps: Ps;
	fs: Fs;
}
