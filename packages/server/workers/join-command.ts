/**
 * The commands that join another machine to the server at
 * `coordinator` with join token `token`, as `splates worker add` and the
 * Workers page hand them out. Browser-safe, for the page.
 */

/** Where the Windows installer of each release is, by its tag. */
export const WINDOWS_INSTALLER =
	"https://raw.githubusercontent.com/stringsync/splates/v{version}/windows/install-worker.ps1";

/** Joins a Linux or macOS machine with splates installed already. */
export function joinCommand(coordinator: string, token: string): string {
	return `splates worker run --server ${coordinator} --join ${token}`;
}

/**
 * Joins a Windows machine, run in PowerShell as an administrator: the
 * installer of release `version`, the server's own, sets up a WSL2
 * distro of its own with this build in it, joins, and starts the worker at
 * each boot (`windows/install-worker.ps1`).
 */
export function windowsJoinCommand(
	coordinator: string,
	token: string,
	version: string,
): string {
	const script = WINDOWS_INSTALLER.replace("{version}", version);
	return `& ([scriptblock]::Create((irm ${script}))) -Coordinator '${coordinator}' -Join '${token}' -Version '${version}'`;
}
