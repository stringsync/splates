import { Access } from "./dev-access";

const CONFIG = { issuer: "https://team.cloudflareaccess.com", aud: "app-aud" };

/**
 * A Cloudflare Access application of a test's own: an `Access` that
 * verifies against its keys, and the tokens it signs, as Access hands one
 * to each request it lets through.
 */
export class FakeAccess {
	private constructor(
		readonly access: Access,
		private readonly keys: CryptoKeyPair,
	) {}

	static async make(): Promise<FakeAccess> {
		const keys = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		);
		const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
		const access = new Access(CONFIG, {
			fetch: (async () =>
				Response.json({
					keys: [{ ...jwk, kid: "k1" }],
				})) as unknown as typeof fetch,
		});
		return new FakeAccess(access, keys);
	}

	/** A token good for a minute, for `me@example.com`. */
	async token(): Promise<string> {
		const signed = `${part({ alg: "RS256", kid: "k1" })}.${part({
			iss: CONFIG.issuer,
			aud: [CONFIG.aud],
			exp: Date.now() / 1000 + 60,
			sub: "user-1",
			email: "me@example.com",
		})}`;
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			this.keys.privateKey,
			new TextEncoder().encode(signed),
		);
		return `${signed}.${encode(new Uint8Array(signature))}`;
	}
}

function encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function part(value: object): string {
	return encode(new TextEncoder().encode(JSON.stringify(value)));
}
