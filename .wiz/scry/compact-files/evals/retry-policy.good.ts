/** How long to wait before each retry of a request the server could not serve. */
export class RetryPolicy {
	constructor(
		private readonly base: number,
		private readonly attempts: number,
	) {}

	/** The delay before the given retry, or undefined once they run out. */
	delay(attempt: number): number | undefined {
		if (attempt >= this.attempts) return undefined;
		return this.base * 2 ** attempt;
	}
}
