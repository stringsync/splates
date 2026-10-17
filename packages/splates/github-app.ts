import { createSign } from "node:crypto";
import { z } from "zod";
import type { Creds } from "./creds";

/** Where GitHub's REST API answers. */
export const GITHUB_API = "https://api.github.com";

/** The cred keeping the GitHub App's id, which its JWTs are issued as. */
export const APP_ID = "SPLATES_GITHUB_APP_ID";
/** The cred keeping the GitHub App's private key, in PEM, which signs its JWTs. */
export const APP_KEY = "SPLATES_GITHUB_APP_KEY";

/** A repository on github.com, as a remote's URL names it. */
export interface GitHubRepo {
	owner: string;
	name: string;
}

/** A token for pushing to one repository, and when it stops working. */
export interface InstallationToken {
	token: string;
	expiresAt: Date;
}

/** What a `GitHubApp` works through; the real ones by default. */
export interface GitHubAppOptions {
	fetch?: typeof fetch;
	/** The time, in ms, its JWTs are issued at. */
	now?: () => number;
}

const Installation = z.object({ id: z.number() });
const Token = z.object({ token: z.string(), expires_at: z.string() });

/**
 * The GitHub App the user installs on a repository, so workers push with a
 * token it mints rather than a credential of the user's. Each token is good
 * for about an hour, for this repository's contents alone, and the ruleset
 * on trunk is what keeps it to `splates/*`: the App can never push main or
 * change the repository's settings.
 */
export class GitHubApp {
	private readonly fetch: typeof fetch;
	private readonly now: () => number;

	constructor(
		private readonly id: string,
		private readonly key: string,
		opts: GitHubAppOptions = {},
	) {
		this.fetch = opts.fetch ?? fetch;
		this.now = opts.now ?? Date.now;
	}

	/** The App whose id and key `creds` keep, or null until both are saved. */
	static async kept(
		creds: Creds,
		opts: GitHubAppOptions = {},
	): Promise<GitHubApp | null> {
		const id = await creds.credentials.get(APP_ID);
		const key = await creds.credentials.get(APP_KEY);
		return id === undefined || key === undefined
			? null
			: new GitHubApp(id, key, opts);
	}

	/**
	 * A token that pushes to `repo`'s contents and nothing else, from the
	 * App's installation there.
	 */
	async token(repo: GitHubRepo): Promise<InstallationToken> {
		const installation = Installation.parse(
			await this.call(
				"GET",
				`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/installation`,
			),
		);
		const minted = Token.parse(
			await this.call(
				"POST",
				`/app/installations/${installation.id}/access_tokens`,
				{ repositories: [repo.name], permissions: { contents: "write" } },
			),
		);
		return { token: minted.token, expiresAt: new Date(minted.expires_at) };
	}

	/**
	 * The App's own JWT, which only finds its installation and mints its
	 * tokens: GitHub takes one for at most ten minutes, issued a minute back
	 * for clocks that drift.
	 */
	jwt(): string {
		const now = Math.floor(this.now() / 1000);
		const encode = (value: unknown) =>
			Buffer.from(JSON.stringify(value)).toString("base64url");
		const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
			iat: now - 60,
			exp: now + 9 * 60,
			iss: this.id,
		})}`;
		const signature = createSign("RSA-SHA256")
			.update(unsigned)
			.sign(this.key, "base64url");
		return `${unsigned}.${signature}`;
	}

	private async call(
		method: string,
		path: string,
		body?: unknown,
	): Promise<unknown> {
		const response = await this.fetch(`${GITHUB_API}${path}`, {
			method,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${this.jwt()}`,
				"x-github-api-version": "2022-11-28",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok) {
			const said = await response.text().catch(() => "");
			throw new Error(
				`GitHub ${method} ${path}: ${response.status} ${said.slice(0, 200)}`.trim(),
			);
		}
		return response.json();
	}
}

/**
 * The github.com repository a remote URL names, in any of the shapes git
 * takes one in; null for a remote anywhere else.
 */
export function githubRepo(url: string): GitHubRepo | null {
	const match =
		/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
			url.trim(),
		);
	return match?.[1] && match[2] ? { owner: match[1], name: match[2] } : null;
}
