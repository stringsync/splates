import { homedir } from "node:os";
import type { Fs, Ps } from "webappwiz/system";

/**
 * Where Kimi Code's installer puts `kimi`, under the home and off the PATH,
 * so the shell looks there after `KIMI_PATH` and the PATH, on whichever
 * machine runs the agent.
 */
const KIMI_BIN = ".kimi-code/bin/kimi";

/** The shell's `kimi`: `KIMI_PATH`, else `kimi` on the PATH, else the installer's. */
const KIMI = `"\${KIMI_PATH:-$(command -v kimi || echo "$HOME/${KIMI_BIN}")}"`;

/** Kimi Code's roster `argv`, starting it as an ACP agent; set `KIMI_PATH` to run a `kimi` of your own. */
export const KIMI_ARGV = ["sh", "-c", `exec ${KIMI} acp`];

/** `kimi` as found for {@link KIMI_ARGV}, ahead of the arguments to run it with. */
export const KIMI_CLI = ["sh", "-c", `exec ${KIMI} "$@"`, "kimi"];

/** Whether Kimi Code is installed on this machine, where {@link KIMI_ARGV} looks. */
export async function kimiInstalled({
	fs,
	ps,
}: {
	fs: Fs;
	ps: Ps;
}): Promise<boolean> {
	const named = ps.env("KIMI_PATH");
	if (named !== undefined) {
		return await fs.exists(named);
	}
	const path = ps.env("PATH");
	if (path !== undefined && Bun.which("kimi", { PATH: path }) !== null) {
		return true;
	}
	return await fs.exists(`${ps.env("HOME") ?? homedir()}/${KIMI_BIN}`);
}
