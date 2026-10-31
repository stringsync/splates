import { bytesOf } from "./base64url";
import type { Subscription } from "./pusher";

/** The record size a push service is told; the message fits in one record. */
const RECORD_SIZE = 4096;

/** What a test fixes to check against a known vector; random otherwise. */
export interface Ephemeral {
	keys: CryptoKeyPair;
	salt: Uint8Array<ArrayBuffer>;
}

/**
 * Encrypts `payload` to `subscription` as an `aes128gcm` body (RFC 8291):
 * a header carrying the salt and this message's public key, then the one
 * record, which only the browser that subscribed can open.
 */
export async function encrypt(
	subscription: Subscription,
	payload: Uint8Array,
	ephemeral?: Ephemeral,
): Promise<Uint8Array<ArrayBuffer>> {
	const browserKey = bytesOf(subscription.keys.p256dh);
	const auth = bytesOf(subscription.keys.auth);
	const { keys, salt } = ephemeral ?? {
		keys: await crypto.subtle.generateKey(
			{ name: "ECDH", namedCurve: "P-256" },
			true,
			["deriveBits"],
		),
		salt: crypto.getRandomValues(new Uint8Array(16)),
	};
	const serverKey = new Uint8Array(
		await crypto.subtle.exportKey("raw", keys.publicKey),
	);
	const shared = await crypto.subtle.deriveBits(
		{
			name: "ECDH",
			public: await crypto.subtle.importKey(
				"raw",
				browserKey,
				{ name: "ECDH", namedCurve: "P-256" },
				false,
				[],
			),
		},
		keys.privateKey,
		256,
	);
	const ikm = await hkdf(
		auth,
		new Uint8Array(shared),
		concat(text("WebPush: info\0"), browserKey, serverKey),
		32,
	);
	const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: nonce },
		await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]),
		// 2 marks the last record, with no padding after it.
		concat(payload, new Uint8Array([2])),
	);
	const size = new Uint8Array(4);
	new DataView(size.buffer).setUint32(0, RECORD_SIZE);
	return concat(
		salt,
		size,
		new Uint8Array([serverKey.length]),
		serverKey,
		new Uint8Array(sealed),
	);
}

async function hkdf(
	salt: Uint8Array<ArrayBuffer>,
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
	length: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt, info },
			key,
			length * 8,
		),
	);
}

function text(value: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(value);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const joined = new Uint8Array(
		parts.reduce((sum, part) => sum + part.length, 0),
	);
	let at = 0;
	for (const part of parts) {
		joined.set(part, at);
		at += part.length;
	}
	return joined;
}
