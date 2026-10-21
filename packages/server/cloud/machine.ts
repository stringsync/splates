import type { SecretStore } from "webappwiz/creds";
import type { Ps } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import { AwsCloud } from "./aws";
import { AwsCredentialSource } from "./aws-credentials";
import type { CloudProvider } from "./provider";

/**
 * The cloud this machine makes the coordinator's box in: AWS, the one cloud
 * splates offers, signed with the AWS CLI's sign-in or the instance role.
 */
export function machineCloud(opts: MachineCloudOptions = {}): CloudProvider {
	return new AwsCloud({
		credentials: new AwsCredentialSource({
			...(opts.ps === undefined ? {} : { ps: opts.ps }),
			...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
		}),
		...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
		...(opts.wait === undefined ? {} : { wait: opts.wait }),
	});
}

/** What `machineCloud` runs on; the real ones by default. */
export interface MachineCloudOptions {
	/** Where a cloud's token would be kept: the device's creds. */
	store?: SecretStore;
	/** Where the environment and the AWS CLI are read; this process by default. */
	ps?: Ps;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at the cloud's actions. */
	wait?: (duration: Duration) => Promise<void>;
}
