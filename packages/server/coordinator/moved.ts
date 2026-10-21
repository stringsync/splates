import { dirname } from "node:path";
import type { Fs, Ps } from "webappwiz/system";
import { WORKER_AGENT } from "./launch-agent";
import { moveRecord } from "./move";
import { COORDINATOR_UNIT } from "./scripts";

/**
 * Whether the coordinator has moved onto its box, read on either side of
 * the move: the box runs `splates server` under its systemd unit, and this
 * Mac keeps the move's record from the moment the box served, whether or
 * not it went on to join the box as a worker under a LaunchAgent.
 */
export async function coordinatorMoved({
	fs,
	ps,
	home,
}: {
	fs: Fs;
	ps?: Ps;
	/** splates's home, under the user's own. */
	home: string;
}): Promise<boolean> {
	const user = ps?.env("HOME") ?? dirname(home);
	return (
		(await fs.exists(`/etc/systemd/system/${COORDINATOR_UNIT}.service`)) ||
		(await moveRecord(fs, home)) !== null ||
		(await fs.exists(`${user}/Library/LaunchAgents/${WORKER_AGENT}.plist`))
	);
}
