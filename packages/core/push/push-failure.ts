/** A push service refused a message; `status` is its HTTP status. */
export class PushFailure extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "PushFailure";
	}

	/** Whether the subscription is gone for good, so it should be forgotten. */
	get gone(): boolean {
		return this.status === 404 || this.status === 410;
	}
}
