import {
	projectName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { type Fs, NodeFs, NodePs } from "webappwiz/system";
import { KeyFileStore } from "./key-file";

/** Where a cred is kept: for this project alone, or every project on this device. */
export const SCOPES = ["project", "device"] as const;
export type Scope = (typeof SCOPES)[number];

/** Who keeps a cred: the machine's own store. */
export const PROVIDERS = ["system"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * The operating system's own stores, shared with `wiz creds`.
 * `SPLATES_SECRET_STORE=keyring` or `file` settles which; unset, the keyring.
 * `file` keeps them in files only this user may read under
 * `~/.splates/secrets/`, for a Linux with no secret service.
 */
export function systemStores(opts: SystemStoresOptions = {}): SecretStores {
	const choice = opts.choice ?? process.env.SPLATES_SECRET_STORE;
	if (choice === "file") {
		const fs = opts.fs ?? new NodeFs();
		// Imported when first used, since models reaches back to creds.
		const dir = async () =>
			`${opts.home ?? (await import("../models")).splatesHome(new NodePs())}/secrets`;
		return {
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
	return {
		project: async (root) => SystemSecretStore.forProject(root),
		device: new LazySecretStore(async () => SystemSecretStore.device()),
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
export type SecretStores = StoreSet;

export interface SystemStoresOptions {
	platform?: string;
	/** `SPLATES_SECRET_STORE`: `keyring` or `file` to choose; unset to detect. */
	choice?: string;
	/** Where `file` keeps its files, splates's home unless a test says otherwise. */
	home?: string;
	fs?: Fs;
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
