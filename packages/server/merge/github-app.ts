import { createSign } from "node:crypto";
import { z } from "zod";
import type { Creds } from "../creds";
import { GitHubRefused } from "./github-refused";

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
	private readonly key: string;

	constructor(
		private readonly id: string,
		key: string,
		opts: GitHubAppOptions = {},
	) {
		this.key = pem(key);
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

	/** What GitHub knows of the App, which a wrong id or key cannot read. */
	async about(): Promise<AppAbout> {
		return About.parse(await this.call("GET", "/app"));
	}

	/** Whether the App is installed on `repo`. */
	async installed(repo: GitHubRepo): Promise<boolean> {
		try {
			await this.call("GET", `${repoPath(repo)}/installation`);
			return true;
		} catch (error) {
			if (error instanceof GitHubRefused && error.status === 404) {
				return false;
			}
			throw error;
		}
	}

	/**
	 * Deletes the App's installation on `repo`, with the App's JWT, which
	 * takes it off every repository it was installed on with that one.
	 * Whether there was one to delete.
	 */
	async uninstall(repo: GitHubRepo): Promise<boolean> {
		let installation: { id: number };
		try {
			installation = Installation.parse(
				await this.call("GET", `${repoPath(repo)}/installation`),
			);
		} catch (error) {
			if (error instanceof GitHubRefused && error.status === 404) {
				return false;
			}
			throw error;
		}
		await this.call("DELETE", `/app/installations/${installation.id}`);
		return true;
	}

	/** `repo`'s rulesets, on branches and tags, read with one of the App's tokens. */
	async rulesets(
		repo: GitHubRepo,
		token: InstallationToken,
	): Promise<RulesetListing[]> {
		return RulesetList.parse(
			await this.call(
				"GET",
				`${repoPath(repo)}/rulesets?targets=branch,tag`,
				undefined,
				token.token,
			),
		);
	}

	/**
	 * The type of each rule `repo`'s rulesets apply to `branch`, as `update`,
	 * read with one of its tokens: whoever a ruleset lets bypass it, the
	 * rule is listed.
	 */
	async rules(
		repo: GitHubRepo,
		branch: string,
		token: InstallationToken,
	): Promise<string[]> {
		const rules = Rules.parse(
			await this.call(
				"GET",
				`${repoPath(repo)}/rules/branches/${encodeURIComponent(branch)}`,
				undefined,
				token.token,
			),
		);
		return rules.map((rule) => rule.type);
	}

	/**
	 * Whether an active tag ruleset of `repo` puts every rule in `types` on
	 * every tag, read with one of the App's tokens. The rules endpoint reads
	 * branches alone, so each tag ruleset is read whole.
	 */
	async tagsRestricted(
		repo: GitHubRepo,
		types: readonly string[],
		token: InstallationToken,
	): Promise<boolean> {
		const listed = RulesetList.parse(
			await this.call(
				"GET",
				`${repoPath(repo)}/rulesets?targets=tag`,
				undefined,
				token.token,
			),
		);
		for (const { id, target, enforcement } of listed) {
			if (target !== "tag" || enforcement !== "active") {
				continue;
			}
			const ruleset = Ruleset.parse(
				await this.call(
					"GET",
					`${repoPath(repo)}/rulesets/${id}`,
					undefined,
					token.token,
				),
			);
			const { include, exclude } = ruleset.conditions?.ref_name ?? {};
			const kinds = ruleset.rules?.map((rule) => rule.type) ?? [];
			if (
				include?.includes("~ALL") &&
				(exclude ?? []).length === 0 &&
				types.every((type) => kinds.includes(type))
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * A token that pushes to `repo`'s contents and nothing else, from the
	 * App's installation there.
	 */
	async token(repo: GitHubRepo): Promise<InstallationToken> {
		const installation = Installation.parse(
			await this.call("GET", `${repoPath(repo)}/installation`),
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
		/** An installation token to ask with, rather than the App's JWT. */
		token?: string,
	): Promise<unknown> {
		const response = await this.fetch(`${GITHUB_API}${path}`, {
			method,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token ?? this.jwt()}`,
				"x-github-api-version": "2022-11-28",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok) {
			const said = await response.text().catch(() => "");
			throw new GitHubRefused(
				response.status,
				`GitHub ${method} ${path}: ${response.status} ${said.slice(0, 200)}`.trim(),
			);
		}
		// A DELETE answers 204, with no body to read.
		return response.status === 204 ? null : response.json();
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

/** Where the REST API keeps `repo`. */
function repoPath(repo: GitHubRepo): string {
	return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

/**
 * `key` as PEM with its line breaks, which a password field strips from a
 * pasted key, leaving one line that will not sign.
 */
function pem(key: string): string {
	const match =
		/^(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----)$/.exec(
			key.trim(),
		);
	if (match === null) {
		return key;
	}
	const body = (match[2] ?? "").replace(/\s+/g, "");
	const lines = body.match(/.{1,64}/g) ?? [];
	return `${[match[1], ...lines, match[3]].join("\n")}\n`;
}

/** The App as GitHub knows it: what it is called and what it may do. */
export interface AppAbout {
	/** Its name in URLs, as in `https://github.com/apps/<slug>`. */
	slug: string;
	/** Each permission it was given, as `contents: "write"`. */
	permissions: Record<string, string>;
	/** The account that owns it, whose settings keep it; none when GitHub leaves it out. */
	owner?: { login: string; type: string } | null;
}

/** A ruleset as `rulesets` lists it. */
export interface RulesetListing {
	id: number;
	name?: string;
	target: string;
	enforcement: string;
}

const Installation = z.object({ id: z.number() });
const Token = z.object({ token: z.string(), expires_at: z.string() });
const About = z.object({
	slug: z.string(),
	permissions: z.record(z.string(), z.string()),
	owner: z.object({ login: z.string(), type: z.string() }).nullish(),
});
const Rules = z.array(z.object({ type: z.string() }));
const RulesetList = z.array(
	z.object({
		id: z.number(),
		name: z.string().optional(),
		target: z.string(),
		enforcement: z.string(),
	}),
);
const Ruleset = z.object({
	conditions: z
		.object({
			ref_name: z
				.object({
					include: z.array(z.string()),
					exclude: z.array(z.string()).optional(),
				})
				.optional(),
		})
		.nullish(),
	rules: z.array(z.object({ type: z.string() })).nullish(),
});
