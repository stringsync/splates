import { SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import { fail } from "./exit";

/**
 * The Cloudflare Access application in front of `arbor dev`: the team it
 * belongs to, as the issuer its tokens name, and its AUD tag. The one place
 * both live, so whatever exposes the page beyond this machine can ask whether
 * Access stands in front of it.
 */
export interface AccessConfig {
	/** The team's own origin, `https://<team>.cloudflareaccess.com`. */
	issuer: string;
	/** The application's AUD tag, which each of its tokens names. */
	aud: string;
}

/**
 * The Access application `--access-team` and `--access-aud` name, or null
 * when neither is given. The team is its name, its domain or its URL alike.
 */
export function accessConfig(team: string, aud: string): AccessConfig | null {
	team = team.trim();
	aud = aud.trim();
	if (team === "" && aud === "") {
		return null;
	}
	if (team === "" || aud === "") {
		fail(
			"usage",
			"Cloudflare Access needs both --access-team and --access-aud",
			{ team, aud },
		);
	}
	const host = team
		.replace(/^https:\/\//, "")
		.replace(/\/+$/, "")
		.replace(/\.cloudflareaccess\.com$/, "");
	if (!/^[a-z0-9-]+$/i.test(host)) {
		fail(
			"usage",
			`invalid Access team '${team}': use its name, as in <team>.cloudflareaccess.com`,
			{ team },
		);
	}
	return { issuer: `https://${host.toLowerCase()}.cloudflareaccess.com`, aud };
}

/** Who a verified token says is asking. */
export interface Identity {
	email: string | null;
	sub: string;
}

/** A request's token, verified or refused with why. */
export type Verified =
	| { identity: Identity; refused?: undefined }
	| { identity?: undefined; refused: string };

/** The header Access sets on each request it lets through to the origin. */
export const ACCESS_HEADER = "cf-access-jwt-assertion";

/** The cookie a browser carries it in, which an upgrade may have alone. */
export const ACCESS_COOKIE = "CF_Authorization";

/** How soon after a refetch an unknown key may fetch the keys again. */
const REFETCH_MS = 60_000;

/**
 * Checks the token Cloudflare Access hands each request against the team's
 * signing keys, so a request that merely claims to come through Access, as
 * any process on this machine could, gets nowhere.
 */
export class Access {
	private keys = new Map<string, CryptoKey>();
	private fetching: Promise<void> | null = null;
	private fetchedAt = Number.NEGATIVE_INFINITY;
	private readonly fetch: typeof fetch;
	private readonly clock: WallClock;

	constructor(
		readonly config: AccessConfig,
		opts: AccessOptions = {},
	) {
		this.fetch = opts.fetch ?? fetch;
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** Where the team publishes the keys its tokens are signed with. */
	get certs(): string {
		return `${this.config.issuer}/cdn-cgi/access/certs`;
	}

	/** Who `request` comes from, by the token in its header or its cookie. */
	async verify(request: Request): Promise<Verified> {
		const token =
			request.headers.get(ACCESS_HEADER) ??
			cookie(request.headers.get("cookie") ?? "", ACCESS_COOKIE);
		if (token === null || token === "") {
			return { refused: "no Cloudflare Access token came with the request" };
		}
		try {
			return { identity: await this.check(token) };
		} catch (error) {
			return {
				refused: `the Cloudflare Access token failed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	private async check(token: string): Promise<Identity> {
		const [head = "", body = "", signature = ""] = token.split(".");
		if (token.split(".").length !== 3) {
			throw new Error("not a JWT");
		}
		const header = Header.parse(decodeJson(head));
		if (header.alg !== "RS256") {
			throw new Error(`unexpected algorithm ${header.alg}`);
		}
		const key = await this.key(header.kid);
		const signed = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			base64url(signature),
			new TextEncoder().encode(`${head}.${body}`),
		);
		if (!signed) {
			throw new Error("bad signature");
		}
		const claims = Claims.parse(decodeJson(body));
		const now = this.clock.now() / 1000;
		if (claims.iss !== this.config.issuer) {
			throw new Error(`issued by ${claims.iss}, not ${this.config.issuer}`);
		}
		const audiences =
			typeof claims.aud === "string" ? [claims.aud] : claims.aud;
		if (!audiences.includes(this.config.aud)) {
			throw new Error("meant for another Access application");
		}
		if (claims.exp <= now) {
			throw new Error("expired");
		}
		if (claims.nbf !== undefined && claims.nbf > now) {
			throw new Error("not valid yet");
		}
		return { email: claims.email ?? null, sub: claims.sub };
	}

	// Keys rotate, so one this has not seen fetches them again, but no more
	// than once a minute, so forged ids cannot make it hammer Cloudflare. A
	// request that comes while a fetch is under way waits for it, as the
	// page's first few do the moment the server starts.
	private async key(kid: string): Promise<CryptoKey> {
		let key = this.keys.get(kid);
		if (
			key === undefined &&
			(this.fetching !== null ||
				this.clock.now() - this.fetchedAt >= REFETCH_MS)
		) {
			this.fetching ??= this.refetch().finally(() => {
				this.fetching = null;
			});
			await this.fetching;
			key = this.keys.get(kid);
		}
		if (key === undefined) {
			throw new Error(`unknown signing key ${kid}`);
		}
		return key;
	}

	private async refetch(): Promise<void> {
		this.fetchedAt = this.clock.now();
		const response = await this.fetch(this.certs);
		if (!response.ok) {
			throw new Error(`fetching ${this.certs} answered ${response.status}`);
		}
		const { keys } = Certs.parse(await response.json());
		const imported = new Map<string, CryptoKey>();
		for (const jwk of keys) {
			if (jwk.kty !== "RSA") {
				continue;
			}
			imported.set(
				jwk.kid,
				await crypto.subtle.importKey(
					"jwk",
					{ kty: jwk.kty, n: jwk.n, e: jwk.e },
					{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
					false,
					["verify"],
				),
			);
		}
		this.keys = imported;
	}
}

/** What an `Access` reaches the world through, swapped in tests. */
export interface AccessOptions {
	fetch?: typeof fetch;
	clock?: WallClock;
}

const Header = z.object({ alg: z.string(), kid: z.string() });

const Claims = z.object({
	iss: z.string(),
	aud: z.union([z.string(), z.array(z.string())]),
	exp: z.number(),
	nbf: z.number().optional(),
	sub: z.string(),
	email: z.string().optional(),
});

const Certs = z.object({
	keys: z.array(
		z.object({
			kid: z.string(),
			kty: z.string(),
			n: z.string(),
			e: z.string(),
		}),
	),
});

function base64url(text: string): Uint8Array<ArrayBuffer> {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(
		atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
		(char) => char.charCodeAt(0),
	);
}

function decodeJson(part: string): unknown {
	return JSON.parse(new TextDecoder().decode(base64url(part)));
}

/** The value of cookie `name` in a Cookie header, or null. */
function cookie(header: string, name: string): string | null {
	for (const pair of header.split(";")) {
		const at = pair.indexOf("=");
		if (at !== -1 && pair.slice(0, at).trim() === name) {
			return pair.slice(at + 1).trim();
		}
	}
	return null;
}
