import {
	projectName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { Imds } from "./imds";
import { SsmSecretStore } from "./ssm";

/** Where a cred is kept: for this project alone, or every project on this device. */
export const SCOPES = ["project", "device"] as const;
export type Scope = (typeof SCOPES)[number];

/** The two stores a cred can be kept in, the system's unless a test says otherwise. */
export interface SecretStores {
	/** The store of the project whose main tree is at `root`. */
	project(root: string): Promise<SecretStore>;
	device: SecretStore;
}

/** A store settled on first use, once it is known which one this machine has. */
class LazySecretStore implements SecretStore {
	private store?: Promise<SecretStore>;

	constructor(private readonly pick: () => Promise<SecretStore>) {}

	get label(): string {
		return "the machine's secret store";
	}

	get(name: string): Promise<string | undefined> {
		return this.settled().then((store) => store.get(name));
	}
	set(name: string, value: string): Promise<void> {
		return this.settled().then((store) => store.set(name, value));
	}
	delete(name: string): Promise<boolean> {
		return this.settled().then((store) => store.delete(name));
	}
	names(): Promise<string[]> {
		return this.settled().then((store) => store.names());
	}

	private settled(): Promise<SecretStore> {
		this.store ??= this.pick();
		return this.store;
	}
}

export interface SystemStoresOptions {
	platform?: string;
	/** `SPLATES_SECRET_STORE`: `ssm` or `keyring` to choose; unset to detect. */
	choice?: string;
	imds?: Imds;
	ssm?: { fetch?: typeof fetch; endpoint?: string; region?: string };
}

/**
 * The operating system's own stores, shared with `wiz creds`, except on a
 * Linux box running under an EC2 instance role, which keeps them in
 * Parameter Store (`/splates/device/`, `/splates/projects/<project>/`) so no
 * secret lies on its disk. `SPLATES_SECRET_STORE=ssm` or `keyring` settles
 * which; unset, the metadata service answering means ssm.
 */
export function systemStores(opts: SystemStoresOptions = {}): SecretStores {
	const choice = opts.choice ?? process.env.SPLATES_SECRET_STORE;
	const platform = opts.platform ?? process.platform;
	const imds = opts.imds ?? new Imds();
	let ssm: Promise<boolean> | undefined;
	const useSsm = () =>
		(ssm ??= choice
			? Promise.resolve(choice === "ssm")
			: platform === "linux"
				? imds.available()
				: Promise.resolve(false));
	const store = (prefix: string) =>
		new SsmSecretStore(prefix, { ...opts.ssm, imds });
	return {
		project: async (root) => {
			if (!(await useSsm())) {
				return SystemSecretStore.forProject(root);
			}
			return store(`/splates/projects/${await projectName(root)}/`);
		},
		device: new LazySecretStore(async () =>
			(await useSsm()) ? store("/splates/device/") : SystemSecretStore.device(),
		),
	};
}

export const SYSTEM_STORES: SecretStores = systemStores();
