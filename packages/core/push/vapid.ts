import { base64url, bytesOf } from "./base64url";

/**
 * The key pair a server signs its pushes with (RFC 8292), each base64url:
 * the public key as an uncompressed P-256 point, which the page subscribes
 * with as `applicationServerKey`, and the private key's scalar.
 */
export interface VapidKeys {
	publicKey: string;
	privateKey: string;
}

/** Makes a new pair, to keep: every subscription made with it needs it. */
export async function generateVapidKeys(): Promise<VapidKeys> {
	const pair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	);
	const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
	if (d === undefined) {
		throw new Error("the private key exported without its scalar");
	}
	return { publicKey: base64url(new Uint8Array(raw)), privateKey: d };
}

/**
 * The `Authorization` header for a push to `endpoint`: a JWT for its origin,
 * signed with `keys`, naming `subject` (a `mailto:` or `https:` URL) for the
 * push service to reach about it, good until `expiresAt` (epoch ms, at most
 * a day off).
 */
export async function vapidAuthorization(
	keys: VapidKeys,
	endpoint: string,
	subject: string,
	expiresAt: number,
): Promise<string> {
	const encode = (value: object) =>
		base64url(new TextEncoder().encode(JSON.stringify(value)));
	const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
		aud: new URL(endpoint).origin,
		exp: Math.floor(expiresAt / 1000),
		sub: subject,
	})}`;
	const point = bytesOf(keys.publicKey);
	const key = await crypto.subtle.importKey(
		"jwk",
		{
			kty: "EC",
			crv: "P-256",
			x: base64url(point.slice(1, 33)),
			y: base64url(point.slice(33, 65)),
			d: keys.privateKey,
		},
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	// WebCrypto signs as r || s, which is what ES256 wants.
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(unsigned),
	);
	return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}
