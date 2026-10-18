/** GitHub refusing a call, with the status it refused with. */
export class GitHubRefused extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
