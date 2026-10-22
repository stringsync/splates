import type { SecretStore } from "webappwiz/creds";
import type { Duration } from "webappwiz/time";
import { DigitalOceanCloud } from "./digitalocean";
import type { CloudProvider } from "./provider";

/** The cloud this machine makes runners in: DigitalOcean, signed with the token the setup keeps. */
export function machineCloud(opts: MachineCloudOptions = {}): CloudProvider {
	return new DigitalOceanCloud({
		...(opts.store === undefined ? {} : { store: opts.store }),
		...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
		...(opts.wait === undefined ? {} : { wait: opts.wait }),
	});
}

/** What `machineCloud` runs on; the real ones by default. */
export interface MachineCloudOptions {
	/** Where the cloud's token is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at the cloud's actions. */
	wait?: (duration: Duration) => Promise<void>;
}
