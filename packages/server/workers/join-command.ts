/**
 * The command that joins another machine to the server at
 * `coordinator` with join token `token`, as `splates worker add` and the
 * Workers page hand it out. Browser-safe, for the page.
 */

/** Joins a Linux or macOS machine with splates installed already. */
export function joinCommand(coordinator: string, token: string): string {
	return `splates worker run --server ${coordinator} --join ${token}`;
}
