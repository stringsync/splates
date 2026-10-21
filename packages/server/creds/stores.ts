import {
	projectName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { AwsKeys, type AwsSource } from "./aws";
import { Imds } from "./imds";
import { SsmSecretStore } from "./ssm";

/** Where a cred is kept: for this project alone, or every project on this device. */
export const SCOPES = ["project", "device"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Who keeps a cred: the machine's own store (the keyring, or Parameter Store
 * on a box under an instance role), or AWS Parameter Store by name.
 */
export const PROVIDERS = ["system", "ssm"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The two stores of one provider. */
export interface StoreSet {
	/** The store of the project whose main tree is at `root`. */
	project(root: string): Promise<SecretStore>;
	device: SecretStore;
}

/** The stores a cred can be kept in, the system's unless a test says otherwise. */
export interface SecretStores extends StoreSet {
	/**
	 * Parameter Store by name, signed with AWS keys or the instance role. Left
	 * off where the system's store already is Parameter Store.
	 */
	ssm?: StoreSet;
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
	const keys = new AwsKeys();
	// The person's own keys first, else the instance role.
	const source: AwsSource = {
		credentials: async () =>
			(await keys.available()) ? keys.credentials() : imds.credentials(),
		region: async () =>
			(await keys.available()) ? keys.region() : imds.region(),
	};
	const store = (prefix: string) =>
		new SsmSecretStore(prefix, { ...opts.ssm, source: imds });
	const named = (prefix: string) =>
		new SsmSecretStore(prefix, { ...opts.ssm, source });
	// Where the system's store is Parameter Store already, a second would list it twice.
	const separate = choice !== "ssm" && !(!choice && platform === "linux");
	return {
		...(separate
			? {
					ssm: {
						project: async (root: string) =>
							named(`/splates/projects/${await projectName(root)}/`),
						device: named("/splates/device/"),
					},
				}
			: {}),
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
