import type { WorkerProvisioningOptions } from "./provisioning";

/** The `workerProvider` the server makes workers with, and what it needs to. */
export type DevWorkerProvider = Pick<
	WorkerProvisioningOptions,
	| "provider"
	| "snapshots"
	| "coordinator"
	| "budget"
	| "wall"
	| "ownBuild"
	| "direct"
>;
