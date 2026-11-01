// biome-ignore lint/suspicious/noControlCharactersInRegex: color escapes
export const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
// The release asking before it publishes.
export const RELEASE_PROMPT = /\(y\/n\)\s*$/;

// Keeps npm from opening a browser on the server's machine.
export const NPM_ENV = { npm_config_browser: "false" };

// The argv that runs a ship's `command` through `sh` with echo off, so nothing
// typed at its terminal lands in the log.
export function quietly(command: string): string[] {
	return ["sh", "-c", `stty -echo 2>/dev/null; ${command}`];
}

// A terminal wide enough that long lines are not wrapped.
export const TERMINAL = { cols: 200, rows: 50 };
