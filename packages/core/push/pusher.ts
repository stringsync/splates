/**
 * Where a browser asked to be pushed to, as `PushSubscription.toJSON()` gives
 * it: the push service's endpoint, and the keys a message is encrypted to.
 */
export interface Subscription {
	endpoint: string;
	keys: {
		/** The browser's P-256 public key, base64url. */
		p256dh: string;
		/** Its 16-byte authentication secret, base64url. */
		auth: string;
	};
}

export interface PushOptions {
	/** How long the push service keeps a message for an offline device; a day by default. */
	ttlSecs?: number;
	urgency?: "very-low" | "low" | "normal" | "high";
	/** A newer message with the same topic replaces one still undelivered. */
	topic?: string;
}

/** Sends a message to a browser's push subscription, for its service worker. */
export interface Pusher {
	push(
		subscription: Subscription,
		payload: string,
		opts?: PushOptions,
	): Promise<void>;
}
