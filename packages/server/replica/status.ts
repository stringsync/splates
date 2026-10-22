import { Duration, timeAgo } from "webappwiz/time";

/** Where a replica stands, for `splates replica` and the page. */
export interface ReplicaStatus {
	/** Where it is, as `s3://records/splates`. */
	replica: string;
	/** When it last held every change, epoch ms; null before it first has. */
	caughtUpAt: number | null;
	/** How many keys have changed since and wait to be shipped. */
	pending: number;
	/** When the oldest change not yet shipped was made, epoch ms; null when none waits. */
	behindSince: number | null;
	/** Why the last batch failed, or why it will not replicate; null when it is well. */
	error: string | null;
}

/**
 * `status` as `splates replica status` prints it, as of `now`; with none
 * recorded, whether the project names a replica says what to do.
 */
export function statusLines(
	status: ReplicaStatus | null,
	named: boolean,
	now: number,
): string[] {
	if (status === null) {
		return [
			named
				? "no replica yet: `splates server` starts it as it serves the project"
				: "no replica: name one as `replica` in splates.config.ts, and `splates server` keeps it",
		];
	}
	const ago = (at: number) => timeAgo(Duration.ms(now - at));
	const { replica, caughtUpAt, behindSince, pending, error } = status;
	return [
		`replica:    ${replica}`,
		`caught up:  ${caughtUpAt === null ? "never" : `${ago(caughtUpAt)} (${new Date(caughtUpAt).toISOString()})`}`,
		`behind by:  ${behindSince === null ? "nothing" : `${pending} change${pending === 1 ? "" : "s"}, the oldest ${ago(behindSince)}`}`,
		...(error === null ? [] : [`failing:    ${error}`]),
	];
}
