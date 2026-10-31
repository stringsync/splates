import { PushFailure } from "./push-failure";
import type { Pusher, PushOptions, Subscription } from "./pusher";

/** One message a test pushed. */
export interface Pushed {
	subscription: Subscription;
	payload: string;
	opts: PushOptions;
}

/** Remembers what it was asked to push, and refuses the endpoints a test says are gone. */
export class FakePusher implements Pusher {
	readonly pushed: Pushed[] = [];
	/** Endpoints it answers 410 for, as a push service does once a browser unsubscribes. */
	readonly gone = new Set<string>();

	async push(
		subscription: Subscription,
		payload: string,
		opts: PushOptions = {},
	): Promise<void> {
		if (this.gone.has(subscription.endpoint)) {
			throw new PushFailure(`${subscription.endpoint} is gone`, 410);
		}
		this.pushed.push({ subscription, payload, opts });
	}
}
