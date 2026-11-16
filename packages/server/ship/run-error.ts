/** A request the runs refuse, as a run that is not there or a step not failed. */
export class RunError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 403 | 404 | 409 = 409,
	) {
		super(message);
	}
}
