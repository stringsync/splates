/**
 * What never goes into a replica nor comes back out of one, as `config
 * export` keeps it back: `creds.json`, which names the person's secrets,
 * locks, which name a process on this machine, and `replica.json`, which
 * names this server as the replica's origin.
 */
const KEPT_BACK = /(^|\/)creds\.json$|\.lock(\/|$)|\.tmp$|^replica\.json$/;

/** Whether `key` is one a replica carries, on the way in and on the way out. */
export function replicated(key: string): boolean {
	return !KEPT_BACK.test(key);
}
