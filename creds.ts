import {
	Credentials,
	credentialName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { type Fs, type Lock, NodeFs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import { fail } from "./exit";

/** Where a cred is kept: for this project alone, or every project on this device. */
export const SCOPES = ["project", "device"] as const;
export type Scope = (typeof SCOPES)[number];

/** How long `wait` gives a request before handing the wait back to its caller. */
export const DEFAULT_TIMEOUT = Duration.mins(15);

/** How often `wait` reads the record again. */
const POLL = Duration.secs(2);

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

const REQUEST = z.object({
	name: z.string(),
	scope: z.enum(SCOPES),
	/** Why it is needed and what for; empty in a record from before requests said. */
	purpose: z.string().default(""),
	/** How to get it, as markdown, from the agent that asked. */
	instructions: z.string(),
	/** The task that asked, or null for an agent in none. */
	task: z.string().nullable(),
	/** Open until a person saves a value for it or dismisses it. */
	status: z.enum(["open", "saved", "dismissed"]),
	requestedAt: z.string(),
});

/** A cred an agent asked a person for, with what for and how to get it. */
export type CredRequest = z.infer<typeof REQUEST>;

const FILE = z.object({
	/** One per name, the latest, so a card in a thread follows what became of it. */
	requests: z.array(REQUEST).default([]),
	/** What saved each cred a tool saved itself, by `<scope>:<name>`. */
	savedBy: z.record(z.string(), z.string()).default({}),
});

type CredsFile = z.infer<typeof FILE>;

/** A cred a store keeps, by name; never its value. */
export interface KeptCred {
	name: string;
	scope: Scope;
	/** The tool that saved it, when one said so; null when a person did. */
	savedBy: string | null;
}

/**
 * A project's creds: the requests agents make for them, which `arbor dev`
 * shows on its Creds page for a person to fill, and the two stores they are
 * kept in, the project's and the device's, as `wiz creds` keeps them. A value
 * goes into a store and never comes out through here but to code reading it
 * through `credentials`, so no agent, page or log ever holds it.
 */
export class Creds {
	readonly #fs: Fs;

	constructor(
		/** The record of requests, `.git/arbor/creds.json`. */
		readonly file: string,
		/** Held while the record is read and written back. */
		private readonly lock: Lock,
		private readonly stores: Record<Scope, SecretStore>,
		opts: { fs?: Fs } = {},
	) {
		this.#fs = opts.fs ?? new NodeFs();
	}

	/** The project's creds, kept in `stores`. */
	static async open(
		arborDir: string,
		root: string,
		lock: Lock,
		stores: SecretStores,
		opts: { fs?: Fs } = {},
	): Promise<Creds> {
		return new Creds(
			`${arborDir}/creds.json`,
			lock,
			{ project: await stores.project(root), device: stores.device },
			opts,
		);
	}

	/**
	 * Where code reads a cred's value: the project's store, then the device's.
	 * Never the environment, so a stray export is not what arbor reads.
	 */
	get credentials(): Credentials {
		return new Credentials([this.stores.project, this.stores.device]);
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
			purpose,
			instructions,
			task,
			replace = false,
		}: {
			scope: Scope;
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
		if (!replace && (await this.has(scope, name))) {
			return null;
		}
		const request: CredRequest = {
			name,
			scope,
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
					`nothing requested ${name}: \`arbor creds request ${name} --purpose '<what for>' --instructions '<how to get it>'\` first`,
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
	 * request's scope, else in `scope`. `by` names the tool saving it, for
	 * the page to say; a person's own save says nothing.
	 */
	async save(
		name: string,
		value: string,
		{ scope, by = null }: { scope?: Scope; by?: string | null } = {},
	): Promise<Scope> {
		usable(name);
		if (value.trim() === "") {
			fail("usage", `no value given for ${name}: nothing saved`, { name });
		}
		let kept: Scope = scope ?? "project";
		await this.change(async (file) => {
			const open = file.requests.find(
				(each) => each.name === name && each.status === "open",
			);
			kept = open?.scope ?? kept;
			await reach(this.stores[kept], (store) => store.set(name, value.trim()));
			if (open !== undefined) {
				open.status = "saved";
			}
			if (by === null) {
				delete file.savedBy[`${kept}:${name}`];
			} else {
				file.savedBy[`${kept}:${name}`] = by;
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

	/** Deletes `name` from `scope`'s store; whether there was one. */
	async remove(name: string, scope: Scope): Promise<boolean> {
		usable(name);
		let deleted = false;
		await this.change(async (file) => {
			deleted = await reach(this.stores[scope], (store) => store.delete(name));
			delete file.savedBy[`${scope}:${name}`];
		});
		return deleted;
	}

	/** Every cred either store keeps, the project's first, by name. */
	async kept(): Promise<KeptCred[]> {
		const { savedBy } = await this.read();
		const kept: KeptCred[] = [];
		for (const scope of SCOPES) {
			for (const name of await reach(this.stores[scope], (store) =>
				store.names(),
			)) {
				kept.push({
					name,
					scope,
					savedBy: savedBy[`${scope}:${name}`] ?? null,
				});
			}
		}
		return kept;
	}

	/** What a person calls `scope`'s store, as in "the macOS Keychain". */
	label(scope: Scope): string {
		return this.stores[scope].label;
	}

	private async has(scope: Scope, name: string): Promise<boolean> {
		return (
			(await reach(this.stores[scope], (store) => store.get(name))) !==
			undefined
		);
	}

	private async read(): Promise<CredsFile> {
		if (!(await this.#fs.exists(this.file))) {
			return FILE.parse({});
		}
		return FILE.parse(JSON.parse(await this.#fs.read(this.file)));
	}

	private async change(
		edit: (file: CredsFile) => void | Promise<void>,
	): Promise<void> {
		await this.lock.acquire();
		try {
			const file = await this.read();
			await edit(file);
			await this.#fs.write(this.file, `${JSON.stringify(file, null, "\t")}\n`);
		} finally {
			await this.lock.release();
		}
	}
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
		fail(
			"no_secret_store",
			`${store.label} cannot be reached: ${(error as Error).message}. On Linux, start a secret service such as GNOME Keyring or KWallet`,
			{},
		);
	}
}
