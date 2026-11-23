/** Why a start was refused, as the page shows it. */
export class RunRefused extends Error {
	constructor(
		message: string,
		readonly status: 404 | 409 | 400,
	) {
		super(message);
	}
}
