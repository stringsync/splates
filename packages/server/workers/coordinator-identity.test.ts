import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { MemorySecretStore } from "webappwiz/creds";
import { Duration, sleep } from "webappwiz/time";
import { CoordinatorIdentity, challengeNonce, proofHolds } from "./identity";

setDefaultTimeout(10_000);

const _KEY = "the-key";

/** Settles once `done` holds, trying every 20ms for up to five seconds. */
async function _until(done: () => boolean): Promise<void> {
	for (let i = 0; i < 250 && !done(); i++) {
		await sleep(Duration.ms(20));
	}
	expect(done()).toBe(true);
}

describe("a coordinator's signing key", () => {
	it("signs a nonce and session only its own public key verifies", () => {
		const coordinator = CoordinatorIdentity.generate();
		const other = CoordinatorIdentity.generate();
		const nonce = challengeNonce();
		const signature = coordinator.prove(nonce, "session");

		expect(proofHolds(coordinator.publicKey, nonce, "session", signature)).toBe(
			true,
		);
		expect(proofHolds(other.publicKey, nonce, "session", signature)).toBe(
			false,
		);
		expect(
			proofHolds(coordinator.publicKey, challengeNonce(), "session", signature),
		).toBe(false);
		expect(proofHolds(coordinator.publicKey, nonce, "other", signature)).toBe(
			false,
		);
		expect(proofHolds("not a key", nonce, "session", signature)).toBe(false);
	});

	it("is made once and kept in the store", async () => {
		const store = new MemorySecretStore("creds");

		const first = await CoordinatorIdentity.open(store);
		const again = await CoordinatorIdentity.open(store);

		expect(again.publicKey).toBe(first.publicKey);
		expect(proofHolds(first.publicKey, "n", "s", again.prove("n", "s"))).toBe(
			true,
		);
	});
});
