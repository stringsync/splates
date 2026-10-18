import type { Logger } from "webappwiz/log";
import { z } from "zod";
import { CloudflareApi } from "../cloudflare-api";
import { CloudflareError } from "../cloudflare-error";
import {
	App,
	CloudflareTunnels,
	type Include,
	Policy,
	SESSION,
	workersPolicy,
} from "../tunnel-setup";
import type { ServiceToken, WorkerAccess } from "./access";

/**
 * How long a worker's service token lasts: until the worker is removed,
 * since a worker cannot ask for a new one once Access turns it away.
 */
export const SERVICE_TOKEN_DURATION = "forever";

const Minted = z.object({
	id: z.string(),
	client_id: z.string(),
	client_secret: z.string(),
});

type AppFound = z.output<typeof App>;

/** What a `CloudflareWorkerAccess` reaches Cloudflare with. */
export interface CloudflareWorkerAccessOptions {
	/** The host the Access application guards, as `splates tunnel setup` was given it. */
	host: string;
	/** The API token `splates tunnel setup` keeps, read at each call so one saved later is used; undefined for none. */
	apiToken: () => Promise<string | undefined>;
	log: Logger;
	fetch?: typeof fetch;
}

/**
 * Mints each worker's service token with the API token `splates tunnel
 * setup` keeps, and lets it through the Access application in front of the
 * page by a Service Auth policy of its own, `<app> workers`, which lists
 * every worker's token and no other, so no service token minted elsewhere
 * in the account gets in. Calls run one at a time, since each rewrites that
 * policy whole.
 */
export class CloudflareWorkerAccess implements WorkerAccess {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly opts: CloudflareWorkerAccessOptions) {}

	mint(): Promise<ServiceToken | null> {
		return this.serially(async () => {
			const api = await this.api();
			if (api === null) {
				this.opts.log.error(
					"no Cloudflare API token is kept, so this worker gets no service token and joins only where it reaches the server without Access: `splates tunnel setup` keeps one",
				);
				return null;
			}
			const { account, app } = await this.app(api);
			const made = await api.post(
				`/accounts/${account}/access/service_tokens`,
				{ name: `${app.name} worker`, duration: SERVICE_TOKEN_DURATION },
				Minted,
			);
			try {
				await this.allow(api, account, app, made.id);
			} catch (error) {
				await api
					.delete(`/accounts/${account}/access/service_tokens/${made.id}`)
					.catch(() => {});
				throw error;
			}
			return {
				id: made.id,
				clientId: made.client_id,
				clientSecret: made.client_secret,
			};
		});
	}

	revoke(id: string): Promise<void> {
		return this.serially(async () => {
			const api = await this.api();
			if (api === null) {
				this.opts.log.error(
					`no Cloudflare API token is kept, so service token ${id} stays: revoke it in Zero Trust → Access → Service Auth`,
				);
				return;
			}
			const { account, app } = await this.app(api);
			await this.disallow(api, account, app, id);
			await api
				.delete(`/accounts/${account}/access/service_tokens/${id}`)
				.catch(passOverGone);
		});
	}

	/** Adds token `id` to the app's workers policy, making it and putting it on the app when there is none. */
	private async allow(
		api: CloudflareApi,
		account: string,
		app: AppFound,
		id: string,
	): Promise<void> {
		const found = await this.policy(api, account, app);
		const want = {
			name: workersPolicy(app.name),
			decision: "non_identity",
			include: [...tokensOf(found?.include ?? []), id].map(rule),
		};
		const policy =
			found === undefined
				? await api.post(`/accounts/${account}/access/policies`, want, Policy)
				: await api.put(
						`/accounts/${account}/access/policies/${found.id}`,
						want,
						Policy,
					);
		if (!app.policies.some((each) => each.id === policy.id)) {
			await this.attach(api, account, app, [
				...app.policies.map((each) => each.id),
				policy.id,
			]);
		}
	}

	/**
	 * Takes token `id` out of the app's workers policy, taking the policy off
	 * the app and deleting it once it lists none, since Access refuses a
	 * policy that includes no one.
	 */
	private async disallow(
		api: CloudflareApi,
		account: string,
		app: AppFound,
		id: string,
	): Promise<void> {
		const found = await this.policy(api, account, app);
		if (found === undefined) {
			return;
		}
		const left = tokensOf(found.include).filter((each) => each !== id);
		if (left.length > 0) {
			await api.put(
				`/accounts/${account}/access/policies/${found.id}`,
				{ name: found.name, decision: found.decision, include: left.map(rule) },
				Policy,
			);
			return;
		}
		if (app.policies.some((each) => each.id === found.id)) {
			await this.attach(
				api,
				account,
				app,
				app.policies.map((each) => each.id).filter((each) => each !== found.id),
			);
		}
		await api
			.delete(`/accounts/${account}/access/policies/${found.id}`)
			.catch(passOverGone);
	}

	private async policy(
		api: CloudflareApi,
		account: string,
		app: AppFound,
	): Promise<z.output<typeof Policy> | undefined> {
		return (
			await api.list(`/accounts/${account}/access/policies`, Policy)
		).find((each) => each.name === workersPolicy(app.name));
	}

	/** Puts `policies` on the app, in order, keeping the rest of it as it is. */
	private async attach(
		api: CloudflareApi,
		account: string,
		app: AppFound,
		policies: string[],
	): Promise<void> {
		await api.put(
			`/accounts/${account}/access/apps/${app.id}`,
			{
				type: "self_hosted",
				name: app.name,
				domain: app.domain,
				session_duration: app.session_duration ?? SESSION,
				policies: policies.map((id, at) => ({ id, precedence: at + 1 })),
			},
			App,
		);
	}

	/** The account and the Access application in front of the host, as they stand now. */
	private async app(
		api: CloudflareApi,
	): Promise<{ account: string; app: AppFound }> {
		const { host } = this.opts;
		const zone = await CloudflareTunnels.over(api, this.opts.log).findZone(
			host,
		);
		const account = zone.account.id;
		const app = (
			await api.list(
				`/accounts/${account}/access/apps?domain=${encodeURIComponent(host)}&exact=true`,
				App,
			)
		).find((each) => each.domain === host);
		if (app === undefined) {
			throw new Error(
				`no Access application guards ${host}: run \`splates tunnel setup\` again`,
			);
		}
		return { account, app };
	}

	private async api(): Promise<CloudflareApi | null> {
		const token = await this.opts.apiToken();
		return token === undefined
			? null
			: new CloudflareApi(token, { fetch: this.opts.fetch });
	}

	private serially<T>(call: () => Promise<T>): Promise<T> {
		const next = this.queue.catch(() => {}).then(call);
		this.queue = next;
		return next;
	}
}

/** The service token ids a policy's `include` lets in. */
export function tokensOf(include: z.output<typeof Include>): string[] {
	return include.flatMap((each) => {
		const id = (each.service_token as { token_id?: unknown } | undefined)
			?.token_id;
		return typeof id === "string" ? [id] : [];
	});
}

function rule(id: string): { service_token: { token_id: string } } {
	return { service_token: { token_id: id } };
}

/** Lets a delete of what is already gone pass. */
function passOverGone(error: unknown): void {
	if (!(error instanceof CloudflareError && error.status === 404)) {
		throw error;
	}
}
