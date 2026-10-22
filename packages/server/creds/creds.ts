import { Credentials, credentialName, type SecretStore } from "webappwiz/creds";
import { Duration, sleep } from "webappwiz/time";
import { renamed } from "../config";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import {
	type CredRequest,
	type CredsFile,
	FILE,
	type KeptCred,
} from "./requests";
import {
	cannotReach,
	type Provider,
	SCOPES,
	type Scope,
	type SecretStores,
} from "./stores";
import { Unreachable } from "./unreachable";

const FILE_KEY = "creds.json";

/** How long `wait` gives a request before handing the wait back to its caller. */
export const DEFAULT_TIMEOUT = Duration.mins(15);

/** How often `wait` reads the record again. */
const POLL = Duration.secs(2);

/**
 * A project's creds: the requests agents make for them, which `splates server`
 * shows on its Creds page for a person to fill, and the two stores they are
 * kept in, the project's and the device's, as `wiz creds` keeps them. A value
 * goes into a store and never comes out through here but to code reading it
 * through `credentials`, so no agent, page or log ever holds it.
 */
export class Creds {
	/** The record of requests, `creds.json`, updated under `creds.lock`. */
	readonly #record: Document<CredsFile>;

	constructor(
		/** The project's, holding `creds.json`. */
		storage: Storage,
		private readonly stores: Record<Scope, SecretStore>,
		/** Parameter Store by name, when the system's store is not it. */
		private readonly ssm?: Record<Scope, SecretStore>,
	) {
		this.#record = storage.document(FILE_KEY, {
			schema: FILE,
			lock: "creds.lock",
		});
	}

	/** The project's creds, kept in `stores`. */
	static async open(
		storage: Storage,
		root: string,
		stores: SecretStores,
	): Promise<Creds> {
		return new Creds(
			storage,
			{ project: await stores.project(root), device: stores.device },
			stores.ssm && {
				project: await stores.ssm.project(root),
				device: stores.ssm.device,
			},
		);
	}

	/**
	 * Where code reads a cred's value: Parameter Store's, when it is a provider
	 * and reachable, then the project's store, then the device's. Never the
	 * environment, so a stray export is not what splates reads.
	 */
	get credentials(): Credentials {
		const ssm = this.ssm && [
			new Unreachable(this.ssm.project),
			new Unreachable(this.ssm.device),
		];
		return new Credentials([
			...(ssm ?? []),
			this.stores.project,
			this.stores.device,
		]);
	}

	/** Who can keep a cred here, the system's first. */
	get providers(): Provider[] {
		return this.ssm ? ["system", "ssm"] : ["system"];
	}

	/** Every request, open or not, the latest first. */
	async requests(): Promise<CredRequest[]> {
		const { requests } = await this.read();
		return requests.toSorted((left, right) =>
			right.requestedAt.localeCompare(left.requestedAt),
		);
	}

	/**
	 * Asks a person for `name`, saying what for, kept in `scope`'s store once they save it.
	 * Asks nothing, returning null, when that store already keeps it, unless
	 * `replace` says the value kept there does not work, and then a purpose or
	 * instructions left off are those of the last request for `name`.
	 */
	async request(
		name: string,
		{
			scope,
			provider = "system",
			purpose,
			instructions,
			task,
			replace = false,
		}: {
			scope: Scope;
			provider?: Provider;
			purpose: string;
			instructions: string;
			task: string | null;
			replace?: boolean;
		},
	): Promise<CredRequest | null> {
		usable(name);
		if (replace && (purpose.trim() === "" || instructions.trim() === "")) {
			const { requests } = await this.read();
			const last = requests.find((each) => each.name === name);
			purpose = purpose.trim() === "" ? (last?.purpose ?? "") : purpose;
			instructions =
				instructions.trim() === "" ? (last?.instructions ?? "") : instructions;
		}
		if (purpose.trim() === "") {
			fail(
				"usage",
				`say why ${name} is needed and what it will be used for with --purpose`,
				{ name },
			);
		}
		if (instructions.trim() === "") {
			fail(
				"usage",
				`say how to get ${name} with --instructions: where to go, what to pick, what to paste`,
				{ name },
			);
		}
		if (!replace && (await this.has(provider, scope, name))) {
			return null;
		}
		const request: CredRequest = {
			name,
			scope,
			provider,
			purpose: purpose.trim(),
			instructions: instructions.trim(),
			task,
			status: "open",
			requestedAt: new Date().toISOString(),
		};
		await this.change((file) => {
			file.requests = [
				...file.requests.filter((each) => each.name !== name),
				request,
			];
		});
		return request;
	}

	/**
	 * Blocks until a person fills or dismisses the request for `name`,
	 * returning what became of it; gives up with `timeout`.
	 */
	async wait(
		name: string,
		{
			timeout = DEFAULT_TIMEOUT,
			poll = POLL,
		}: { timeout?: Duration; poll?: Duration } = {},
	): Promise<"saved" | "dismissed"> {
		const deadline = Date.now() + timeout.ms;
		for (;;) {
			const { requests } = await this.read();
			const found = requests.find((each) => each.name === name);
			if (found === undefined) {
				fail(
					"not_found",
					`nothing requested ${name}: \`splates creds request ${name} --purpose '<what for>' --instructions '<how to get it>'\` first`,
					{ name },
				);
			}
			if (found.status !== "open") {
				return found.status;
			}
			if (Date.now() >= deadline) {
				fail(
					"timeout",
					`${name} is still not saved after ${timeout.secs}s: wait again, or carry on with what does not need it`,
					{ name },
				);
			}
			await sleep(poll);
		}
	}

	/**
	 * Keeps `value` as `name`, filling its request if one is open, in the
	 * request's scope, in `provider` if given, else the request's, and else
	 * `scope` and the system's. `by` names the tool saving it, for
	 * the page to say; a person's own save says nothing.
	 */
	async save(
		name: string,
		value: string,
		{
			scope,
			provider,
			by = null,
		}: { scope?: Scope; provider?: Provider; by?: string | null } = {},
	): Promise<Scope> {
		usable(name);
		if (value.trim() === "") {
			fail("usage", `no value given for ${name}: nothing saved`, { name });
		}
		let kept: Scope = scope ?? "project";
		let keptBy: Provider = "system";
		await this.change(async (file) => {
			const open = file.requests.find(
				(each) => each.name === name && each.status === "open",
			);
			kept = open?.scope ?? kept;
			keptBy = provider ?? open?.provider ?? "system";
			await reach(this.store(keptBy, kept), (store) =>
				store.set(name, value.trim()),
			);
			if (open !== undefined) {
				open.status = "saved";
			}
			const key = savedKey(keptBy, kept, name);
			if (by === null) {
				delete file.savedBy[key];
			} else {
				file.savedBy[key] = by;
			}
		});
		return kept;
	}

	/** Turns down the open request for `name`, so its agent stops waiting. */
	async dismiss(name: string): Promise<void> {
		await this.change((file) => {
			const open = file.requests.find(
				(each) => each.name === name && each.status === "open",
			);
			if (open === undefined) {
				fail("not_found", `no open request for ${name}`, { name });
			}
			open.status = "dismissed";
		});
	}

	/** Deletes `name` from `provider`'s `scope` store; whether there was one. */
	async remove(
		name: string,
		scope: Scope,
		provider: Provider = "system",
	): Promise<boolean> {
		usable(name);
		let deleted = false;
		await this.change(async (file) => {
			deleted = await reach(this.store(provider, scope), (store) =>
				store.delete(name),
			);
			delete file.savedBy[savedKey(provider, scope, name)];
		});
		return deleted;
	}

	/**
	 * Copies each cred kept under arbor's `ARBOR_*` name to its `SPLATES_*`
	 * one in the same store, unless that is kept already. The old one stays,
	 * for an arbor still running, and any record naming it, to read.
	 */
	async copyLegacy(): Promise<void> {
		for (const scope of SCOPES) {
			await reach(this.store("system", scope), async (store) => {
				const names = await store.names();
				for (const old of names) {
					const name = renamed(old);
					const value =
						name === null || names.includes(name)
							? undefined
							: await store.get(old);
					if (name !== null && value !== undefined) {
						await store.set(name, value);
					}
				}
			});
		}
	}

	/**
	 * Every cred the stores keep, each provider's project store first, by name.
	 * Parameter Store out of reach lists nothing rather than hide the rest.
	 */
	async kept(): Promise<KeptCred[]> {
		const { savedBy } = await this.read();
		const kept: KeptCred[] = [];
		for (const provider of this.providers) {
			for (const scope of SCOPES) {
				const store = this.store(provider, scope);
				const names =
					provider === "system"
						? await reach(store, (each) => each.names())
						: await store.names().catch(() => []);
				for (const name of names) {
					kept.push({
						name,
						scope,
						provider,
						savedBy: savedBy[savedKey(provider, scope, name)] ?? null,
					});
				}
			}
		}
		return kept;
	}

	/** What a person calls a store, as in "the macOS Keychain". */
	label(scope: Scope, provider: Provider = "system"): string {
		return this.store(provider, scope).label;
	}

	private store(provider: Provider, scope: Scope): SecretStore {
		const stores = provider === "ssm" ? this.ssm : this.stores;
		if (stores === undefined) {
			fail("usage", `${provider} is not a provider of creds here`, {
				provider,
			});
		}
		return stores[scope];
	}

	private async has(
		provider: Provider,
		scope: Scope,
		name: string,
	): Promise<boolean> {
		return (
			(await reach(this.store(provider, scope), (store) => store.get(name))) !==
			undefined
		);
	}

	private async read(): Promise<CredsFile> {
		return (await this.#record.read()) ?? FILE.parse({});
	}

	private async change(
		edit: (file: CredsFile) => void | Promise<void>,
	): Promise<void> {
		await this.#record.update(async (current) => {
			const file = current ?? FILE.parse({});
			await edit(file);
			return file;
		});
	}
}

/** Where `savedBy` notes who saved a cred; the system's keep their old keys. */
function savedKey(provider: Provider, scope: Scope, name: string): string {
	return provider === "system"
		? `${scope}:${name}`
		: `${provider}:${scope}:${name}`;
}

/** `name`, refused unless an environment variable could have it. */
function usable(name: string): void {
	try {
		credentialName(name);
	} catch (error) {
		fail("usage", (error as Error).message, { name });
	}
}

/**
 * What `use` does with `store`, or a refusal saying the system keeps no
 * secrets, as on a headless Linux with no secret service running.
 */
async function reach<T>(
	store: SecretStore,
	use: (store: SecretStore) => Promise<T>,
): Promise<T> {
	try {
		return await use(store);
	} catch (error) {
		fail("no_secret_store", cannotReach(store, error), {});
	}
}
