import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	sign,
	verify,
} from "node:crypto";
import type { SecretStore } from "webappwiz/creds";

/** What the server's signing key is kept as, with its other creds. */
export const COORDINATOR_SIGNING_KEY = "SPLATES_COORDINATOR_SIGNING_KEY";

/** A fresh nonce for a worker to challenge a server with. */
export function challengeNonce(): string {
	return randomBytes(32).toString("base64url");
}

/** The bytes a proof signs: the worker's nonce and the session the server answers as. */
function proven(nonce: string, session: string): Buffer {
	return Buffer.from(`splates-coordinator-v1\n${nonce}\n${session}`);
}

/**
 * Whether `signature` is `publicKey`'s signature over `nonce` and
 * `session`, as `CoordinatorIdentity.prove` makes it. False for a key or
 * signature that cannot be read.
 */
export function proofHolds(
	publicKey: string,
	nonce: string,
	session: string,
	signature: string,
): boolean {
	try {
		const key = createPublicKey({
			key: Buffer.from(publicKey, "base64url"),
			format: "der",
			type: "spki",
		});
		return verify(
			null,
			proven(nonce, session),
			key,
			Buffer.from(signature, "base64url"),
		);
	} catch {
		return false;
	}
}

/**
 * The Ed25519 key a server proves itself to its workers with. Cloudflare
 * serves one certificate for every connector of a tunnel, so a stolen tunnel
 * token lets an impostor answer for the server's host; only the holder
 * of this key can sign a worker's nonce. Its public half is in each join
 * token, which a worker keeps beside its own key.
 */
export class CoordinatorIdentity {
	private constructor(
		private readonly privateKey: ReturnType<typeof createPrivateKey>,
		/** The public key, SPKI as base64url, as a join token carries it. */
		readonly publicKey: string,
	) {}

	/** A key kept nowhere, for a server with no store. */
	static generate(): CoordinatorIdentity {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		return new CoordinatorIdentity(
			privateKey,
			publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
		);
	}

	/** The key kept in `store`, made and kept there at the first start. */
	static async open(store: SecretStore): Promise<CoordinatorIdentity> {
		const kept = await store.get(COORDINATOR_SIGNING_KEY);
		if (kept !== undefined) {
			const privateKey = createPrivateKey({
				key: Buffer.from(kept, "base64url"),
				format: "der",
				type: "pkcs8",
			});
			return new CoordinatorIdentity(
				privateKey,
				createPublicKey(privateKey.export({ format: "pem", type: "pkcs8" }))
					.export({ format: "der", type: "spki" })
					.toString("base64url"),
			);
		}
		const made = CoordinatorIdentity.generate();
		await store.set(
			COORDINATOR_SIGNING_KEY,
			made.privateKey
				.export({ format: "der", type: "pkcs8" })
				.toString("base64url"),
		);
		return made;
	}

	/** Its signature over a worker's `nonce` and the `session` it answers as. */
	prove(nonce: string, session: string): string {
		return sign(null, proven(nonce, session), this.privateKey).toString(
			"base64url",
		);
	}
}
