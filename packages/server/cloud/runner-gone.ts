/** The runner's machine is gone, so nothing will answer for it again. */
export class RunnerGone extends Error {
	constructor(readonly id: string) {
		super(`runner machine ${id} is gone`);
		this.name = "RunnerGone";
	}
}
