/** The handlers `Feed` sets on its `EventSource`, for a test to call. */
export interface Stream {
	onmessage: ((event?: { data: string }) => void) | null;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	/** The listeners for named events, such as `removed`. */
	named?: Map<string, (event: { data: string }) => void>;
	/** Whether the page closed it. */
	closed?: boolean;
}

/**
 * A stream the server would send, standing in for `EventSource` on the page:
 * the handlers it set and the listeners it added, for a test to call.
 */
export class FakeStream implements Stream {
	onmessage: (() => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	readonly named = new Map<string, (event: { data: string }) => void>();
	closed = false;

	addEventListener(
		name: string,
		listener: (event: { data: string }) => void,
	): void {
		this.named.set(name, listener);
	}

	// `EventSource`'s own name for it, which `Feed` calls.
	close(): void {
		this.closed = true;
	}
}
