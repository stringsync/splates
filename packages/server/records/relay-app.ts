import { z } from "zod";
import type { InstallationToken } from "../github-app";
import type { AppSource, TokenMinter } from "../task-branches";
import type { StateProject } from "./repo-state";

/** What `RelayApp` reaches the coordinator through; the global `fetch` by default. */
export interface RelayAppOptions {
	fetch?: typeof fetch;
}

/** A token this close to expiring is asked for again. */
const MARGIN_MS = 5 * 60 * 1000;

const Answer = z.object({
	value: z.object({ token: z.string(), expiresAt: z.string() }).nullable(),
});

/**
 * The GitHub App as a command on a worker reaches it: through the relay, the
 * coordinator minting each token (`POST /api/token`), since the App's key
 * never leaves it. A token is held in this process's memory alone, and asked
 * for again as it nears its expiry.
 */
export class RelayApp implements AppSource {
	private readonly fetch: typeof fetch;
	/** The last token minted, or null once the coordinator said it keeps no App. */
	private held: Promise<InstallationToken | null> | undefined;

	constructor(
		private readonly url: string,
		private readonly project: StateProject,
		opts: RelayAppOptions = {},
	) {
		this.fetch = opts.fetch ?? fetch;
	}

	async app(): Promise<TokenMinter | null> {
		return (await this.current()) === null
			? null
			: {
					token: async () => {
						const token = await this.current();
						if (token === null) {
							throw new Error("the coordinator keeps no GitHub App any more");
						}
						return token;
					},
				};
	}

	private async current(): Promise<InstallationToken | null> {
		const held = await this.held?.catch(() => undefined);
		if (
			held === null ||
			(held !== undefined && held.expiresAt.getTime() - Date.now() >= MARGIN_MS)
		) {
			return held;
		}
		this.held = this.mint();
		return this.held;
	}

	private async mint(): Promise<InstallationToken | null> {
		const response = await this.fetch(`${this.url}/api/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ project: this.project }),
		});
		if (!response.ok) {
			const said = await response.text().catch(() => "");
			throw new Error(
				`the coordinator minted no token: ${response.status} ${said.slice(0, 200)}`.trim(),
			);
		}
		const { value } = Answer.parse(await response.json());
		return value === null
			? null
			: { token: value.token, expiresAt: new Date(value.expiresAt) };
	}
}
