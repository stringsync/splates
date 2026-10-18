import { z } from "zod";
import { refuse } from "../server/shared";
import type { DevWorkers } from ".";
import { KEY_PROVIDERS, type KeyHolder, keyProvider } from ".";

/** What `PUT /api/workers/keys` is sent: whose key, of which provider, and its value. */
const KeyAdd = z.union([
	z.object({
		provider: z.string(),
		worker: z.string().min(1),
		value: z.string(),
	}),
	z.object({
		provider: z.string(),
		type: z.string().min(1),
		value: z.string(),
	}),
]);

/**
 * `/api/workers/keys`: the API keys workers hold, listed by whose and which
 * provider's, kept from the Creds page and deleted from it. A value only
 * ever comes in: no route answers with one.
 */
export class WorkerKeyRoutes {
	constructor(
		private readonly workers: Pick<
			DevWorkers,
			"keys" | "registry" | "slots" | "provisioning" | "delivery"
		>,
	) {}

	/** Lists on a GET, keeps on a PUT, deletes on a DELETE. */
	readonly handle = (request: Request): Promise<Response> =>
		request.method === "PUT"
			? this.addKey(request)
			: request.method === "DELETE"
				? this.removeKey(request)
				: this.listKeys();

	/**
	 * `GET /api/workers/keys`: every worker's API key, by whose and which
	 * provider's, never its value, with the providers and who may hold one:
	 * each registered worker, and each type the provider makes.
	 */
	readonly listKeys = async (): Promise<Response> => {
		const types = await this.workers.provisioning?.types().catch(() => []);
		return Response.json({
			keys: this.workers.keys?.all ?? [],
			providers: KEY_PROVIDERS,
			holders: {
				workers: this.workers.registry.workers
					.filter((worker) => worker.kind === "registered")
					.map((worker) => worker.id),
				types: (types ?? []).map((type) => type.name),
			},
		});
	};

	/**
	 * `PUT /api/workers/keys`: keeps a provider's API key for a registered
	 * worker or a type of made worker, over the one it held, and places
	 * whoever waited for it.
	 */
	readonly addKey = async (request: Request): Promise<Response> => {
		const body = KeyAdd.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(
				400,
				"usage",
				"say the provider, the worker or type that holds the key, and the key",
			);
		}
		const keys = this.workers.keys;
		if (keys === null) {
			return refuse(400, "usage", "this coordinator keeps no worker keys");
		}
		const { provider, value } = body.data;
		const holder: KeyHolder =
			"worker" in body.data
				? { worker: body.data.worker }
				: { type: body.data.type };
		if (keyProvider(provider) === undefined) {
			return refuse(
				400,
				"usage",
				`no provider ${provider}: one of ${KEY_PROVIDERS.map((each) => each.id).join(", ")}`,
			);
		}
		if (value.trim() === "") {
			return refuse(400, "usage", "no key given: nothing kept");
		}
		if ("worker" in holder) {
			const worker = this.workers.registry.worker(holder.worker);
			if (worker === undefined || worker.kind === "local") {
				return refuse(
					404,
					"not_found",
					worker === undefined
						? `no worker ${holder.worker}`
						: "this machine's worker runs agents signed in as you, and needs no key",
				);
			}
		}
		const key = await keys.add(holder, provider, value);
		await this.workers.delivery.resend();
		this.workers.slots.scheduler.poke();
		void this.workers.provisioning?.refill();
		return Response.json({ key });
	};

	/** `DELETE /api/workers/keys?provider=&worker=` (or `&type=`): deletes that key. */
	readonly removeKey = async (request: Request): Promise<Response> => {
		const params = new URL(request.url).searchParams;
		const provider = params.get("provider");
		const worker = params.get("worker");
		const type = params.get("type");
		if (provider === null || (worker === null) === (type === null)) {
			return refuse(
				400,
				"usage",
				"say the provider, and the worker or type that holds the key",
			);
		}
		const holder = worker === null ? { type: type ?? "" } : { worker };
		if (!(await this.workers.keys?.remove(holder, provider))) {
			return refuse(404, "not_found", `no ${provider} key held there`);
		}
		await this.workers.delivery.resend();
		return Response.json({ removed: true });
	};
}
