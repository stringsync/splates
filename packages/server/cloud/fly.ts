import {
	projectName,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import { FlyError } from "./fly-error";
import { FLY_SIZES } from "./fly-sizes";
import type {
	FlyMachine,
	FlyMachines,
	FlySize,
	FlyState,
	NewFlyMachine,
} from "./fly-types";
import type { CloudToken } from "./provider";
import { TypeRefused } from "./provider";

/** Fly Machines, using the person's device token; the runner's image and lifecycle belong to the caller. */
export class FlyCloud implements FlyMachines {
	readonly name = "Fly.io";
	readonly billing = "fly";
	readonly configSource = "new FlyCloud()";
	readonly token: CloudToken = FLY_TOKEN;
	readonly regions: readonly string[];
	private readonly store: SecretStore;
	private readonly fetch: typeof globalThis.fetch;
	private ready: Promise<string> | undefined;
	private projectRoot: string | undefined;

	constructor(private readonly opts: FlyCloudOptions = {}) {
		this.store = opts.store ?? SystemSecretStore.device();
		this.fetch = opts.fetch ?? globalThis.fetch;
		this.regions = opts.regions ?? FLY_REGIONS;
	}

	/** Resolves the default app from the configured project even in a multi-project server. */
	inProject(root: string): FlyCloud {
		const cloud = new FlyCloud(this.opts);
		cloud.projectRoot = root;
		return cloud;
	}

	async accepted(): Promise<boolean> {
		if ((await this.store.get(FLY_API_TOKEN)) === undefined) {
			return false;
		}
		try {
			await this.request("/apps");
			return true;
		} catch (error) {
			if (error instanceof FlyError && [401, 403].includes(error.status)) {
				return false;
			}
			throw error;
		}
	}

	async sizes(): Promise<FlySize[]> {
		return FLY_SIZES.map((size) => ({ ...size }));
	}

	async create(spec: NewFlyMachine): Promise<FlyMachine> {
		const app = await this.ensureApp();
		try {
			return await this.request<FlyMachine>(`/apps/${app}/machines`, "POST", {
				...(spec.name === undefined ? {} : { name: spec.name }),
				region: spec.region,
				config: {
					image: spec.image,
					env: spec.env,
					metadata: spec.metadata,
					...(spec.cmd === undefined ? {} : { init: { cmd: spec.cmd } }),
					auto_destroy: spec.autoDestroy,
					guest: {
						cpu_kind: spec.size.cpuKind,
						cpus: spec.size.cpus,
						memory_mb: spec.size.memory * 1024,
						persist_rootfs: spec.persistRootfs,
					},
					services: spec.services,
					restart: { policy: "no" },
				},
			});
		} catch (error) {
			if (
				error instanceof FlyError &&
				[400, 409, 422, 503].includes(error.status) &&
				/no capacity|insufficient capacity|not enough resources|size|cpu|memory|resource.*unavailable/i.test(
					error.reason,
				)
			) {
				throw new TypeRefused(spec.size.name, error.message);
			}
			throw error;
		}
	}

	async machine(id: string): Promise<FlyMachine | null> {
		try {
			return await this.request<FlyMachine>(await this.path(id));
		} catch (error) {
			if (error instanceof FlyError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async list(metadata: Record<string, string> = {}): Promise<FlyMachine[]> {
		const query = new URLSearchParams(
			Object.entries(metadata).map(([key, value]) => [
				`metadata.${key}`,
				value,
			]),
		);
		try {
			const machines = await this.request<FlyMachine[]>(
				`/apps/${await this.appName()}/machines?${query}`,
			);
			return machines.filter((machine) =>
				Object.entries(metadata).every(
					([key, value]) => machine.config.metadata?.[key] === value,
				),
			);
		} catch (error) {
			if (error instanceof FlyError && error.status === 404) {
				return [];
			}
			throw error;
		}
	}

	async start(id: string): Promise<void> {
		await this.request(await this.path(id, "/start"), "POST");
	}
	async stop(id: string): Promise<void> {
		await this.request(await this.path(id, "/stop"), "POST");
	}
	async destroy(id: string): Promise<void> {
		try {
			await this.request(await this.path(id, "?force=true"), "DELETE");
		} catch (error) {
			if (error instanceof FlyError && error.status === 404) {
				return;
			}
			throw error;
		}
	}

	/** Each call waits at most 60 seconds; callers own any longer lifecycle deadline. */
	async wait(id: string, state: FlyState): Promise<void> {
		await this.request(
			await this.path(
				id,
				`/wait?state=${encodeURIComponent(state)}&timeout=60`,
			),
		);
	}

	async appName(): Promise<string> {
		return encodeURIComponent(
			this.opts.app ??
				`splates-${(await projectName(this.projectRoot)).toLowerCase().replace(/[^a-z0-9-]/g, "-")}-runners`,
		);
	}

	private async path(id: string, suffix = ""): Promise<string> {
		return `/apps/${await this.appName()}/machines/${encodeURIComponent(id)}${suffix}`;
	}

	private async ensureApp(): Promise<string> {
		this.ready ??= this.prepareApp().catch((error) => {
			this.ready = undefined;
			throw error;
		});
		return this.ready;
	}

	private async prepareApp(): Promise<string> {
		const app = await this.appName();
		try {
			await this.request(`/apps/${app}`);
		} catch (error) {
			if (!(error instanceof FlyError && error.status === 404)) {
				throw error;
			}
			try {
				await this.request("/apps", "POST", {
					app_name: decodeURIComponent(app),
					org_slug: this.opts.org ?? "personal",
				});
			} catch (createError) {
				if (!(createError instanceof FlyError && createError.status === 409)) {
					throw createError;
				}
				await this.request(`/apps/${app}`);
			}
		}
		const data = await this.graphql<{
			app: {
				sharedIpAddress: string | null;
				ipAddresses: { nodes: { type: string }[] };
			};
		}>(
			"query($name: String!) { app(name: $name) { sharedIpAddress ipAddresses { nodes { type } } } }",
			{ name: decodeURIComponent(app) },
		);
		for (const type of ["shared_v4", "v6"]) {
			if (
				type === "shared_v4"
					? data.app.sharedIpAddress !== null
					: data.app.ipAddresses.nodes.some((ip) => ip.type === "v6")
			) {
				continue;
			}
			await this.graphql(
				"mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { app { name } } }",
				{ input: { appId: decodeURIComponent(app), type } },
			);
		}
		return app;
	}

	private async graphql<T>(query: string, variables: unknown): Promise<T> {
		const result = await this.request<{
			data: T;
			errors?: { message: string }[];
		}>("https://api.fly.io/graphql", "POST", { query, variables });
		if (result.errors?.length) {
			throw new FlyError(
				200,
				result.errors.map((error) => error.message).join("; "),
			);
		}
		return result.data;
	}

	private async request<T = unknown>(
		path: string,
		method = "GET",
		body?: unknown,
	): Promise<T> {
		const token = await this.store.get(FLY_API_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no Fly.io API token: do the setup step \`cloud-token\`, which keeps it as ${FLY_API_TOKEN}`,
			);
		}
		const response = await this.fetch(
			path.startsWith("https:") ? path : `https://api.machines.dev/v1${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
		);
		if (!response.ok) {
			const raw = await response.text();
			// Error responses can echo the request: redact all submitted env values and the token.
			let reason = raw.replaceAll(token, "[redacted]");
			const env = (
				body as { config?: { env?: Record<string, string> } } | undefined
			)?.config?.env;
			for (const value of Object.values(env ?? {})) {
				if (value) {
					reason = reason.replaceAll(value, "[redacted]");
				}
			}
			throw new FlyError(response.status, reason);
		}
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

export interface FlyCloudOptions {
	app?: string;
	/** Organization used only when creating an app; app-scoped tokens need an existing app. */
	org?: string;
	regions?: readonly string[];
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
}

export const FLY_API_TOKEN = "FLY_API_TOKEN";
export const FLY_REGIONS = ["ewr", "iad", "ord", "lax"] as const;
const FLY_TOKEN: CloudToken = {
	cred: FLY_API_TOKEN,
	label: "Fly.io API token",
	help: "At [Fly.io dashboard tokens](https://fly.io/dashboard), create an organization or app-scoped deploy token. An app-scoped token needs the runners' app created first; an organization token can create it on first use.",
	refused:
		"Fly.io does not take that token: create an organization or app-scoped deploy token and paste it again.",
};
