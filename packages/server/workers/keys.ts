import type { SecretStore } from "webappwiz/creds";
import { SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import type { Document } from "../storage";
import type { SentKey, TaskKey } from "./task-keys";

/** The provider `id` names; undefined for none. */
export function keyProvider(id: string): KeyProvider | undefined {
	return KEY_PROVIDERS.find((each) => each.id === id);
}

/** The provider whose key `agent` runs on; undefined for an agent that needs none. */
export function providerOf(agent: string): KeyProvider | undefined {
	return KEY_PROVIDERS.find((each) => each.agents.includes(agent));
}

/**
 * A provider whose console makes the API keys workers run its agents on.
 * Neither sets a spend limit on a key itself: Anthropic sets one on the
 * workspace the key is made in, OpenAI on its project, so each holder of a
 * key gets a workspace or project of its own.
 */
export interface KeyProvider {
	id: string;
	name: string;
	/** The environment variable its agent CLIs read a key from. */
	env: string;
	/** The agents on the roster that run on its keys, by id. */
	agents: string[];
	/** Where a key is made. */
	keys: string;
	/** Where the spend limit of the key's workspace or project is set. */
	limits: string;
	/** What a key is made in, which its limit is set on. */
	scope: string;
	/** How a worker's credential proxy forwards its agents' requests with the key. */
	proxy: ProviderProxy;
}

/** The roster's file in `~/.splates`. */
export const WORKER_KEYS_FILE = "worker-keys.json";

/** Each provider a worker can hold a key of, by id. */
export const KEY_PROVIDERS: readonly KeyProvider[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		env: "ANTHROPIC_API_KEY",
		agents: ["claude"],
		keys: "https://platform.claude.com/settings/keys",
		limits: "https://platform.claude.com/settings/workspaces",
		scope: "workspace",
		proxy: {
			upstream: "https://api.anthropic.com",
			header: "x-api-key",
			base: "ANTHROPIC_BASE_URL",
		},
	},
	{
		id: "openai",
		name: "OpenAI",
		env: "OPENAI_API_KEY",
		agents: ["codex"],
		keys: "https://platform.openai.com/api-keys",
		limits: "https://platform.openai.com/settings/organization/projects",
		scope: "project",
		proxy: {
			upstream: "https://api.openai.com/v1",
			header: "authorization",
			scheme: "Bearer",
			base: "OPENAI_BASE_URL",
		},
	},
];

/**
 * Who holds a key: one registered worker, by its id, or every worker a
 * provider makes of one type, since those come and go faster than a key
 * can be made in a console.
 */
export type KeyHolder = { worker: string } | { type: string };

const Holder = z.union([
	z.object({ worker: z.string().min(1) }),
	z.object({ type: z.string().min(1) }),
]);

const Entry = z.object({
	provider: z.string(),
	holder: Holder,
	/** The name its value is kept under in the store. */
	cred: z.string(),
	addedAt: z.string(),
});

/** One key on the roster: whose, of which provider, and where it is kept; never its value. */
export type WorkerKey = z.infer<typeof Entry>;

const Kept = z.object({ keys: z.array(Entry).default([]) });

/** A worker as `WorkerKeys.holds` asks about it. */
export interface KeyedWorker {
	id: string;
	/** The type a provider made it as; null for one that joined by hand. */
	type: string | null;
}

/**
 * The coordinator's roster of workers' API keys: which provider's key each
 * worker, or type of worker a provider makes, holds. Each value lives in
 * `store`, the device's, under a name of its own; the roster in `document`
 * keeps only that name, so the file lets no one spend a key.
 */
export class WorkerKeys {
	/** Serializes writes, so two changes never race to the file. */
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly store: SecretStore,
		private readonly document: Document<{ keys: WorkerKey[] }> | null,
		private readonly wall: WallClock,
		private kept: WorkerKey[],
	) {}

	/** Reads the roster `document` keeps, or starts empty when it keeps nothing readable. */
	static async open(
		document: Document<{ keys: WorkerKey[] }>,
		store: SecretStore,
		wall: WallClock = new SystemWallClock(),
	): Promise<WorkerKeys> {
		let kept: WorkerKey[] = [];
		try {
			const read = await document.read();
			if (read !== null) {
				kept = Kept.parse(read).keys;
			}
		} catch {
			// Unreadable: every key is added again.
		}
		return new WorkerKeys(store, document, wall, kept);
	}

	/** A roster kept in memory alone, its values in `store`. */
	static memory(
		store: SecretStore,
		wall: WallClock = new SystemWallClock(),
	): WorkerKeys {
		return new WorkerKeys(store, null, wall, []);
	}

	get all(): WorkerKey[] {
		return [...this.kept];
	}

	/** The keys `worker` holds, of its own or its type's, by provider; its own first. */
	of(worker: KeyedWorker): WorkerKey[] {
		const own = this.kept.filter(
			(each) => "worker" in each.holder && each.holder.worker === worker.id,
		);
		const typed = this.kept.filter(
			(each) =>
				"type" in each.holder &&
				each.holder.type === worker.type &&
				!own.some((mine) => mine.provider === each.provider),
		);
		return [...own, ...typed];
	}

	/** Whether `worker` holds the key `agent` runs on, or `agent` needs none. */
	holds(worker: KeyedWorker, agent: string): boolean {
		const provider = providerOf(agent);
		return (
			provider === undefined ||
			this.of(worker).some((each) => each.provider === provider.id)
		);
	}

	/** Whether workers of `type` hold the key `agent` runs on, or `agent` needs none. */
	typeHolds(type: string, agent: string): boolean {
		return this.holds({ id: "", type }, agent);
	}

	/** `provider`'s key for `holder`, kept as `value`, over the one it held. */
	async add(
		holder: KeyHolder,
		provider: string,
		value: string,
	): Promise<WorkerKey> {
		const found = keyProvider(provider);
		if (found === undefined) {
			throw new Error(
				`no provider ${provider}: one of ${KEY_PROVIDERS.map((each) => each.id).join(", ")}`,
			);
		}
		if (value.trim() === "") {
			throw new Error(`no ${found.name} key given: nothing kept`);
		}
		const was = this.find(holder, provider);
		const key: WorkerKey = {
			provider,
			holder,
			cred: was?.cred ?? this.credFor(holder, found),
			addedAt: new Date(this.wall.now()).toISOString(),
		};
		await this.store.set(key.cred, value.trim());
		await this.change((kept) => [...kept.filter((each) => each !== was), key]);
		return key;
	}

	/** Deletes `provider`'s key for `holder`; whether it held one. */
	async remove(holder: KeyHolder, provider: string): Promise<boolean> {
		const was = this.find(holder, provider);
		if (was === undefined) {
			return false;
		}
		await this.store.delete(was.cred);
		await this.change((kept) => kept.filter((each) => each !== was));
		return true;
	}

	/**
	 * Deletes every key worker `id` holds of its own, as when it is removed;
	 * its type's stay for the others of that type.
	 */
	async forget(id: string): Promise<WorkerKey[]> {
		const gone = this.kept.filter(
			(each) => "worker" in each.holder && each.holder.worker === id,
		);
		for (const key of gone) {
			await this.store.delete(key.cred);
		}
		await this.change((kept) => kept.filter((each) => !gone.includes(each)));
		return gone;
	}

	/** The value of `key`, for what hands it to a worker; undefined once it is gone. */
	value(key: WorkerKey): Promise<string | undefined> {
		return this.store.get(key.cred);
	}

	/** Every key `worker` holds, with its value, as a worker is sent them. */
	async sent(worker: KeyedWorker): Promise<SentKey[]> {
		const sent: SentKey[] = [];
		for (const key of this.of(worker)) {
			const value = await this.value(key);
			if (value !== undefined) {
				sent.push({ cred: key.cred, value });
			}
		}
		return sent;
	}

	/** The key `agent` runs on at `worker`, by name, for its process to be proxied; none for an agent that needs none. */
	taskKeys(worker: KeyedWorker, agent: string): TaskKey[] {
		const provider = providerOf(agent);
		const key = this.of(worker).find((each) => each.provider === provider?.id);
		return key === undefined
			? []
			: [{ provider: key.provider, cred: key.cred }];
	}

	private find(holder: KeyHolder, provider: string): WorkerKey | undefined {
		return this.kept.find(
			(each) => each.provider === provider && sameHolder(each.holder, holder),
		);
	}

	/**
	 * A store name for `provider`'s key for `holder` that no other key has:
	 * `SPLATES_ANTHROPIC_KEY_WORKER_HOME_PC`, numbered on when two ids read
	 * alike once made a name.
	 */
	private credFor(holder: KeyHolder, provider: KeyProvider): string {
		const [what, id] =
			"worker" in holder ? ["WORKER", holder.worker] : ["TYPE", holder.type];
		const base = `SPLATES_${provider.id.toUpperCase()}_KEY_${what}_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
		const taken = new Set(this.kept.map((each) => each.cred));
		let name = base;
		for (let at = 2; taken.has(name); at++) {
			name = `${base}_${at}`;
		}
		return name;
	}

	private change(next: (kept: WorkerKey[]) => WorkerKey[]): Promise<void> {
		this.kept = next(this.kept);
		const document = this.document;
		if (document === null) {
			return Promise.resolve();
		}
		const keys = this.kept;
		this.writing = this.writing
			.catch(() => {})
			.then(() => document.write({ keys }));
		return this.writing;
	}
}

function sameHolder(one: KeyHolder, other: KeyHolder): boolean {
	return "worker" in one
		? "worker" in other && one.worker === other.worker
		: "type" in other && one.type === other.type;
}

/**
 * Where a worker's `CredentialProxy` sends a provider's requests, and how
 * its agent CLIs are pointed at the proxy instead.
 */
export interface ProviderProxy {
	/** The provider's API origin, with any path requests go under. */
	upstream: string;
	/** The header the key travels in. */
	header: string;
	/** The word before the key in `header`, if any. */
	scheme?: string;
	/** The environment variable its agent CLIs read their base URL from. */
	base: string;
}
