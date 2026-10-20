import type { Ps } from "webappwiz/system";
import { z } from "zod";
import type { Document, Storage } from "../storage";

/** What `server.json` holds: the `splates server` serving on this machine. */
const ServingFile = z.object({
	/** Where it listens, on this machine's own name. */
	url: z.string(),
	pid: z.number(),
	/** The splates it runs. */
	release: z.string(),
});

/** The `splates server` on this machine, as one serving says it. */
export type ServingServer = Omit<z.infer<typeof ServingFile>, "pid">;

/**
 * Where the `splates server` on this machine says it listens, in the
 * machine's storage, so a command such as `splates update` finds it: written
 * once it listens, and taken back as it stops.
 */
export class Serving {
	private readonly document: Document<z.infer<typeof ServingFile>>;

	constructor(
		machine: Storage,
		private readonly ps: Ps,
	) {
		this.document = machine.document("server.json", { schema: ServingFile });
	}

	/** Says this process serves at `url`, running `release`. */
	async say(url: string, release: string): Promise<void> {
		await this.document.write({ url, pid: this.ps.pid, release });
	}

	/** Takes back what `say` wrote, unless another server has written since. */
	async forget(): Promise<void> {
		const said = await this.document.read().catch(() => null);
		if (said?.pid === this.ps.pid) {
			await this.document.remove();
		}
	}

	/** The server that said it serves, while its process lives; null for none. */
	async running(): Promise<ServingServer | null> {
		const said = await this.document.read().catch(() => null);
		if (said === null || !this.ps.alive(said.pid)) {
			return null;
		}
		return { url: said.url, release: said.release };
	}
}
