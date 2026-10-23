/** An API refusal excludes request bodies and authentication headers, which may contain secrets. */
export class FlyError extends Error {
	constructor(
		readonly status: number,
		readonly reason: string,
	) {
		super(`Fly API refused the request (${status}): ${reason}`);
		this.name = "FlyError";
	}
}
