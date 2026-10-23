import type { Resource } from "webappwiz/disposable";
import type { Ps } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";

/**
 * The environment variable that ends a worker with the process that started
 * it. Set it to that process's pid on the worker `splates server` runs beside
 * itself, and the worker ends once the pid is gone.
 */
// A server killed outright would otherwise leave its worker serving on under
// the id `local` beside the next server's.
export const SUPERVISOR = "SPLATES_WORKER_SUPERVISOR";

/** How often a supervised worker looks for its supervisor. */
const SUPERVISOR_POLL = Duration.secs(5);

/**
 * Calls `end` once the supervisor `SUPERVISOR` names has gone, looking every
 * `SUPERVISOR_POLL`; null for a worker no server supervises.
 */
export function endWithSupervisor(
	ps: Pick<Ps, "env" | "alive">,
	timer: Timer,
	end: () => void,
): Resource | null {
	const pid = Number.parseInt(ps.env(SUPERVISOR) ?? "", 10);
	if (!Number.isInteger(pid)) {
		return null;
	}
	const watch = timer.setInterval(() => {
		if (!ps.alive(pid)) {
			watch.dispose();
			end();
		}
	}, SUPERVISOR_POLL);
	return watch;
}
