import { CredentialProxy, type CredentialSource } from "webappwiz/creds";
import type { AsyncResource } from "webappwiz/disposable";
import { z } from "zod";
import { keyProvider } from "./keys";

/** The capability of a worker that keeps keys it is sent and proxies its agents' (protocol 1.5). */
export const KEYS = "keys";

/**
 * A key a process on a worker runs on: its provider's id, and the name the
 * worker keeps its value under. Only the name crosses on a `process`
 * channel; the value comes on its own, in a `keys` call.
 */
export const TaskKey = z.object({ provider: z.string(), cred: z.string() });
export type TaskKey = z.infer<typeof TaskKey>;

/** A key's value as a `keys` call carries it, under the name it is kept as. */
export const SentKey = z.object({ cred: z.string(), value: z.string() });
export type SentKey = z.infer<typeof SentKey>;

/**
 * The credential proxies one process on a worker runs its agent's requests
 * through: one per key it names, each reading the key from the worker's
 * store, so the process is handed only a placeholder and the proxy's URL.
 * Where each proxy forwards is the worker's own `KEY_PROVIDERS`, never
 * anything the coordinator sends, so a key goes only to its provider.
 */
export class TaskKeys implements AsyncResource {
	private constructor(
		private readonly proxies: CredentialProxy[],
		/** What to add to the process's env: each provider's placeholder key and base URL. */
		readonly env: Record<string, string>,
	) {}

	/** Starts a proxy for each of `keys`, reading values from `source`; throws for a provider this worker does not know. */
	static start(keys: TaskKey[], source: CredentialSource | null): TaskKeys {
		const proxies: CredentialProxy[] = [];
		const env: Record<string, string> = {};
		try {
			for (const { provider: id, cred } of keys) {
				if (source === null) {
					throw new Error(
						"this worker keeps no keys, so it cannot run an agent on one",
					);
				}
				const provider = keyProvider(id);
				if (provider === undefined) {
					throw new Error(`this worker knows no key provider ${id}`);
				}
				const { upstream, header, scheme, base } = provider.proxy;
				const proxy = CredentialProxy.listen(source, {
					upstream,
					credential: cred,
					header,
					...(scheme === undefined ? {} : { scheme }),
				});
				proxies.push(proxy);
				env[provider.env] = proxy.placeholder;
				env[base] = proxy.url;
			}
		} catch (error) {
			for (const proxy of proxies) {
				void proxy.disposeAsync();
			}
			throw error;
		}
		return new TaskKeys(proxies, env);
	}

	/** Stops every proxy; safe to call again. */
	async disposeAsync(): Promise<void> {
		const proxies = this.proxies.splice(0);
		await Promise.all(proxies.map((proxy) => proxy.disposeAsync()));
	}
}
