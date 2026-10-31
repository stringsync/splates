/** Ways of bringing an `AbortSignal` to bear on work that does not take one. */
export class aborts {
	private constructor() {}

	/**
	 * Settles with `promise`, or rejects with the signal's reason if that comes
	 * first. The underlying work is not cancelled, since a promise cannot be:
	 * this stops the caller waiting on it.
	 */
	static race<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
		if (signal.aborted) {
			return Promise.reject(signal.reason);
		}

		return new Promise<T>((resolve, reject) => {
			const onAbort = () => reject(signal.reason);
			signal.addEventListener("abort", onAbort, { once: true });

			const settled = () => signal.removeEventListener("abort", onAbort);
			promise.then(
				(value) => {
					settled();
					resolve(value);
				},
				(error: unknown) => {
					settled();
					reject(error);
				},
			);
		});
	}
}
