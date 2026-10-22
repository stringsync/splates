/** A request DigitalOcean answered with an error, with its status and its own reason. */
export class DigitalOceanError extends Error {
	constructor(
		readonly status: number,
		readonly reason: string,
		request: string,
	) {
		super(`DigitalOcean answered ${status} to ${request}: ${reason}`);
		this.name = "DigitalOceanError";
	}
}
