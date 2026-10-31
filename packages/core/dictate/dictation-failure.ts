/** Why a take broke off, and the cred it needs, when that is why. */
export class DictationFailure extends Error {
	constructor(
		message: string,
		readonly cred: string | undefined,
	) {
		super(message);
	}
}
