import {
	projectName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { type Fs, NodeFs, NodePs } from "webappwiz/system";
import { AwsKeys, type AwsSource } from "./aws";
import { Imds } from "./imds";
import { KeyFileStore } from "./key-file";
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

/**
 * The operating system's own stores, shared with `wiz creds`, except on a
 * Linux box running under an EC2 instance role, which keeps them in
 * Parameter Store (`/splates/device/`, `/splates/projects/<project>/`) so no
 * secret lies on its disk. `SPLATES_SECRET_STORE=ssm` or `keyring` settles
 * which; unset, the metadata service answering means ssm. `file` keeps them
 * in files only this user may read under `~/.splates/secrets/`, for a Linux
 * with neither a secret service nor an instance role, as `splates worker
 * run --key-file` keeps a worker's key.
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
	const parameterStore: StoreSet = {
		project: async (root) =>
			named(`/splates/projects/${await projectName(root)}/`),
		device: named("/splates/device/"),
	};
	if (choice === "file") {
		const fs = opts.fs ?? new NodeFs();
		// Imported when first used, since models reaches back to creds.
		const dir = async () =>
			`${opts.home ?? (await import("../models")).splatesHome(new NodePs())}/secrets`;
		return {
			ssm: parameterStore,
			project: async (root) =>
				new KeyFileStore(
					`${await dir()}/projects/${await projectName(root)}.env`,
					fs,
				),
			device: new LazySecretStore(
				async () => new KeyFileStore(`${await dir()}/device.env`, fs),
			),
		};
	}
	// Where the system's store is Parameter Store already, a second would list it twice.
	const separate = choice !== "ssm" && !(!choice && platform === "linux");
	return {
		...(separate ? { ssm: parameterStore } : {}),
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

/**
 * Why `store` refused, and what a Linux with no secret service can do: run
 * one, or keep its secrets in files.
 */
export function cannotReach(store: SecretStore, error: unknown): string {
	const why = error instanceof Error ? error.message : String(error);
	return `${store.label} cannot be reached: ${why}. On Linux, start a secret service such as GNOME Keyring or KWallet, or set SPLATES_SECRET_STORE=file to keep secrets in files only this user may read under ~/.splates/secrets/`;
}

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

export interface SystemStoresOptions {
	platform?: string;
	/** `SPLATES_SECRET_STORE`: `ssm`, `keyring` or `file` to choose; unset to detect. */
	choice?: string;
	/** Where `file` keeps its files, splates's home unless a test says otherwise. */
	home?: string;
	fs?: Fs;
	imds?: Imds;
	ssm?: { fetch?: typeof fetch; endpoint?: string; region?: string };
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

export const SYSTEM_STORES: SecretStores = systemStores();
