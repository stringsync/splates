import type { Opened, Opening } from "./worker";

/**
 * `navigator.serviceWorker` for a test: registered or not, keeping what its
 * registration was asked to show, and passing on a click as the worker does.
 */
export class FakeWorkers {
	/** What the registration showed, by title and what its click opens. */
	readonly shown: { title: string; data: Opening }[] = [];
	private readonly listeners = new Set<(event: { data: Opened }) => void>();

	constructor(private readonly registered: boolean) {}

	/** Puts it in place of the browser's own, until the test deletes it. */
	install(): this {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: this,
		});
		return this;
	}

	async getRegistration(): Promise<
		Pick<ServiceWorkerRegistration, "showNotification"> | undefined
	> {
		if (!this.registered) {
			return undefined;
		}
		return {
			showNotification: async (title, options) => {
				this.shown.push({ title, data: options?.data as Opening });
			},
		};
	}

	async register(): Promise<void> {}

	addEventListener(
		_type: "message",
		listener: (event: { data: Opened }) => void,
	): void {
		this.listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: { data: Opened }) => void,
	): void {
		this.listeners.delete(listener);
	}

	/** Passes on a click on the notification for row `key`. */
	clicked(key: string): void {
		for (const listener of this.listeners) {
			listener({ data: { type: "arbor:open", key } });
		}
	}
}
