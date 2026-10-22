import type { Logger } from "webappwiz/log";
import { z } from "zod";
import {
	App,
	CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	type Include,
	Policy,
	SESSION,
	SLOTS_APP,
	workersPolicy,
} from "../tunnel";
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

/**
 * The account, the name the workers' policy and applications are named for,
 * and the page's application a token's policy may need taking off; null for a
 * slot, whose wildcard application is never given one.
 */
interface Guard {
	account: string;
	name: string;
	app: AppFound | null;
}

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
 * setup` keeps, and lets it through at the paths only a worker calls, each its own Access application carrying a
 * Service Auth policy of its own, `<app> workers`, which lists every
 * worker's token and no other, so no service token minted elsewhere in the
 * account gets in, and a leaked one reaches no more than a worker key does.
 * The page's application never carries it. Calls run one at a time, since
 * each rewrites that policy whole.
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
			const guard = await this.app(api);
			const { account, name } = guard;
			const made = await api.post(
				`/accounts/${account}/access/service_tokens`,
				{ name: `${name} worker`, duration: SERVICE_TOKEN_DURATION },
				Minted,
			);
			try {
				await this.allow(api, guard, made.id);
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
			const guard = await this.app(api);
			await this.disallow(api, guard, id);
			const { account } = guard;
			await api
				.delete(`/accounts/${account}/access/service_tokens/${id}`)
				.catch(passOverGone);
		});
	}

	/** Adds token `id` to the workers policy, making it and the workers' applications when there is none. */
	private async allow(
		api: CloudflareApi,
		{ account, name, app }: Guard,
		id: string,
	): Promise<void> {
		const found = await this.policy(api, account, name);
		const want = {
			name: workersPolicy(name),
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
		await CloudflareTunnels.over(api, this.opts.log).ensureWorkerApps(
			account,
			name,
			this.opts.host,
			policy.id,
		);
		await this.detach(api, account, app, policy.id);
	}

	/**
	 * Takes token `id` out of the workers policy, deleting it and the
	 * workers' applications once it lists none, since Access refuses a
	 * policy that includes no one.
	 */
	private async disallow(
		api: CloudflareApi,
		{ account, name, app }: Guard,
		id: string,
	): Promise<void> {
		const found = await this.policy(api, account, name);
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
		await CloudflareTunnels.over(api, this.opts.log).dropWorkerApps(
			account,
			this.opts.host,
		);
		await this.detach(api, account, app, found.id);
		await api
			.delete(`/accounts/${account}/access/policies/${found.id}`)
			.catch(passOverGone);
	}

	private async policy(
		api: CloudflareApi,
		account: string,
		name: string,
	): Promise<z.output<typeof Policy> | undefined> {
		return (
			await api.list(`/accounts/${account}/access/policies`, Policy)
		).find((each) => each.name === workersPolicy(name));
	}

	/**
	 * Takes policy `id` off the page's application, which an earlier version
	 * put it on, so a worker's token reaches the workers' paths alone.
	 */
	private async detach(
		api: CloudflareApi,
		account: string,
		app: AppFound | null,
		id: string,
	): Promise<void> {
		if (app === null || !app.policies.some((each) => each.id === id)) {
			return;
		}
		const policies = app.policies
			.map((each) => each.id)
			.filter((each) => each !== id);
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

	/**
	 * What guards the host, as it stands now: its own Access application, or,
	 * for a slot's `<word>.<zone>`, the slots' wildcard one, which slots share,
	 * so a slot's workers are named for its tunnel, `splates-<word>`.
	 */
	private async app(api: CloudflareApi): Promise<Guard> {
		const { host } = this.opts;
		const zone = await CloudflareTunnels.over(api, this.opts.log).findZone(
			host,
		);
		const account = zone.account.id;
		const app = await this.guarding(api, account, host);
		if (app !== undefined) {
			return { account, name: app.name, app };
		}
		const word = host.slice(0, -`.${zone.name}`.length);
		const slots =
			host.endsWith(`.${zone.name}`) && !word.includes(".")
				? await this.guarding(api, account, `*.${zone.name}`)
				: undefined;
		if (slots?.name === SLOTS_APP) {
			return { account, name: `splates-${word}`, app: null };
		}
		throw new Error(
			`no Access application guards ${host}: run \`splates tunnel setup\` again`,
		);
	}

	private async guarding(
		api: CloudflareApi,
		account: string,
		domain: string,
	): Promise<AppFound | undefined> {
		return (
			await api.list(
				`/accounts/${account}/access/apps?domain=${encodeURIComponent(domain)}&exact=true`,
				App,
			)
		).find((each) => each.domain === domain);
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
