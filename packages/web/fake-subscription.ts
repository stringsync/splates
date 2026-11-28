import type { Resource } from "core/disposable";

/** A push subscription for a test, made with the key it was given. */
export class FakeSubscription implements Resource {
	unsubscribed = false;
	readonly options: { applicationServerKey: ArrayBuffer };

	constructor(
		readonly endpoint: string,
		key: string,
	) {
		this.options = {
			applicationServerKey: Uint8Array.fromBase64(key, {
				alphabet: "base64url",
			}).buffer,
		};
	}

	toJSON(): PushSubscriptionJSON {
		return { endpoint: this.endpoint, keys: { p256dh: "BKey", auth: "auth" } };
	}

	dispose(): void {
		this.unsubscribed = true;
	}

	async unsubscribe(): Promise<boolean> {
		this.dispose();
		return true;
	}
}
