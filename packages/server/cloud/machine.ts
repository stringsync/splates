import type { SecretStore } from "webappwiz/creds";
import type { Duration } from "webappwiz/time";
import { HetznerCloud } from "./hetzner";
import type { CloudProvider } from "./provider";

/**
 * The cloud this machine makes the coordinator's box in, and whose token
 * its setup asks for: the one place outside a project's `splates.config.ts`
 * that picks a cloud. Hetzner is the only one so far.
 */
export function machineCloud(opts: MachineCloudOptions = {}): CloudProvider {
	return new HetznerCloud(opts);
}

/** What `machineCloud` runs on; the real ones by default. */
export interface MachineCloudOptions {
	/** Where the cloud's token is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at the cloud's actions. */
	wait?: (duration: Duration) => Promise<void>;
}
