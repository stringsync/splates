import { randomUUID } from "node:crypto";
import type { SecretStore } from "core/creds";
import { z } from "zod";
import { APP_ID, APP_KEY, GITHUB_API } from "../merge";

/** Where a manifest is posted to, to have GitHub make the App from it. */
const NEW_APP_FROM_MANIFEST = "https://github.com/settings/apps/new";

/** Where the page returns to once the App is made, on its GitHub step. */
const AFTER = "/#setup/github/github-app";

/** How long a started flow waits for GitHub to send the person back. */
const STATE_MS = 60 * 60 * 1000;

const Converted = z.object({ id: z.number(), pem: z.string().min(1) });

/**
 * Makes the splates GitHub App from a manifest: the page posts the manifest
 * to GitHub, the person confirms there, and GitHub sends the browser back
 * with a one-time code, which this exchanges for the App's id and private
 * key and keeps for the device. It saves what the person would paste, so the
 * steps after it read no differently.
 */
export class GitHubAppManifest {
	readonly #device: SecretStore;
	readonly #fetch: typeof fetch;
	readonly #now: () => number;
	/** The states handed out and when each lapses, so a callback is one we asked for. */
	readonly #states = new Map<string, number>();

	constructor(
		device: SecretStore,
		opts: { fetch?: typeof fetch; now?: () => number } = {},
	) {
		this.#device = device;
		this.#fetch = opts.fetch ?? fetch;
		this.#now = opts.now ?? Date.now;
	}

	/** The manifest for an App whose redirect comes back to `origin`. */
	static manifest(origin: string): Record<string, unknown> {
		return {
			name: "splates",
			url: "https://github.com/stringsync/splates",
			redirect_url: `${origin}/api/setup/github-app/callback`,
			public: false,
			hook_attributes: { url: origin, active: false },
			default_permissions: { contents: "write" },
		};
	}

	/** What the page posts to GitHub: where, and the manifest, with a state to check on return. */
	readonly start = async (request: Request): Promise<Response> => {
		const now = this.#now();
		for (const [state, lapses] of this.#states) {
			if (lapses <= now) {
				this.#states.delete(state);
			}
		}
		const state = randomUUID();
		this.#states.set(state, now + STATE_MS);
		return Response.json({
			url: `${NEW_APP_FROM_MANIFEST}?state=${state}`,
			manifest: JSON.stringify(
				GitHubAppManifest.manifest(new URL(request.url).origin),
			),
		});
	};

	/** Where GitHub sends the browser: keeps the App it made, then returns to its step. */
	readonly callback = async (request: Request): Promise<Response> => {
		const params = new URL(request.url).searchParams;
		const code = params.get("code") ?? "";
		const state = params.get("state") ?? "";
		const lapses = this.#states.get(state);
		this.#states.delete(state);
		if (code === "" || lapses === undefined || lapses <= this.#now()) {
			return new Response(
				"This link is not one splates started, or it has lapsed: start again from the Setup page.",
				{ status: 400 },
			);
		}
		const response = await this.#fetch(
			`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`,
			{
				method: "POST",
				headers: { accept: "application/vnd.github+json" },
			},
		);
		if (!response.ok) {
			return new Response(
				`GitHub would not hand over the App (${response.status}): start again from the Setup page.`,
				{ status: 502 },
			);
		}
		const { id, pem } = Converted.parse(await response.json());
		await this.#device.set(APP_ID, String(id));
		await this.#device.set(APP_KEY, pem);
		return new Response(null, { status: 302, headers: { location: AFTER } });
	};
}
