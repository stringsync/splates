import { SystemWallClock, type WallClock } from "core/time";
import { encrypt } from "./encrypt";
import { PushFailure } from "./push-failure";
import type { Pusher, PushOptions, Subscription } from "./pusher";
import { type VapidKeys, vapidAuthorization } from "./vapid";

export interface WebPusherOptions {
	fetch?: typeof fetch;
	clock?: WallClock;
}

/** How long a signed push stays good; push services refuse more than a day. */
const SIGNED_FOR_MS = 12 * 60 * 60 * 1000;

const DAY_SECS = 24 * 60 * 60;

/**
 * Sends Web Push messages (RFC 8030), each encrypted to its subscription
 * and signed with `keys` as the server they subscribed to.
 */
export class WebPusher implements Pusher {
	private readonly fetcher: typeof fetch;
	private readonly clock: WallClock;

	/** `subject` is a `mailto:` or `https:` URL a push service can reach the sender at. */
	constructor(
		private readonly keys: VapidKeys,
		private readonly subject: string,
		opts: WebPusherOptions = {},
	) {
		this.fetcher = opts.fetch ?? fetch;
		this.clock = opts.clock ?? new SystemWallClock();
	}

	async push(
		subscription: Subscription,
		payload: string,
		opts: PushOptions = {},
	): Promise<void> {
		const headers: Record<string, string> = {
			authorization: await vapidAuthorization(
				this.keys,
				subscription.endpoint,
				this.subject,
				this.clock.now() + SIGNED_FOR_MS,
			),
			"content-encoding": "aes128gcm",
			"content-type": "application/octet-stream",
			ttl: String(opts.ttlSecs ?? DAY_SECS),
		};
		if (opts.urgency !== undefined) {
			headers.urgency = opts.urgency;
		}
		if (opts.topic !== undefined) {
			headers.topic = opts.topic;
		}
		const response = await this.fetcher(subscription.endpoint, {
			method: "POST",
			headers,
			body: await encrypt(subscription, new TextEncoder().encode(payload)),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new PushFailure(
				`${new URL(subscription.endpoint).origin} answered ${response.status}: ${text.slice(0, 300)}`,
				response.status,
			);
		}
	}
}
