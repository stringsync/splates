import { type SecretStore, SystemSecretStore } from "webappwiz/creds";

/** Where a cred is kept: for this project alone, or every project on this device. */
export const SCOPES = ["project", "device"] as const;
export type Scope = (typeof SCOPES)[number];

/** The two stores a cred can be kept in, the system's unless a test says otherwise. */
export interface SecretStores {
	/** The store of the project whose main tree is at `root`. */
	project(root: string): Promise<SecretStore>;
	device: SecretStore;
}

/** The operating system's own stores, shared with `wiz creds`. */
export const SYSTEM_STORES: SecretStores = {
	project: (root) => SystemSecretStore.forProject(root),
	device: SystemSecretStore.device(),
};
