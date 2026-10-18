import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Ps } from "webappwiz/system";
import { hostOf } from "./machine";

/** Keeps the machine from sleeping while held, as a worker does while it runs anything. */
export interface KeepAwake {
	/** Holds the machine awake until the answer is disposed. */
	hold(): Resource;
}

/**
 * Holds the system awake through Windows' `SetThreadExecutionState`, from a
 * `powershell.exe` WSL starts on the Windows side. The display may still
 * sleep. It waits on its stdin, so it ends when this side does, however
 * that ends; the hold goes with its thread.
 */
const HOLD_SCRIPT = [
	"$t = Add-Type -Name Awake -Namespace Splates -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);'",
	// ES_CONTINUOUS | ES_SYSTEM_REQUIRED
	"$null = $t::SetThreadExecutionState([uint32]'0x80000001')",
	"$null = [Console]::In.ReadToEnd()",
].join("; ");

/** Keeps Windows awake from a worker under WSL. */
export class WindowsKeepAwake implements KeepAwake {
	constructor(
		private readonly ps: Ps,
		private readonly log: Logger,
	) {}

	hold(): Resource {
		let child: Child;
		try {
			child = this.ps.start([
				"powershell.exe",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				HOLD_SCRIPT,
			]);
		} catch (error) {
			this.log.error(`cannot keep Windows awake: ${String(error)}`);
			return { dispose: () => {} };
		}
		void child.exited.then((code) => {
			if (code !== 0 && code < 128) {
				this.log.error(`keeping Windows awake ended with ${code}`);
			}
		});
		return {
			dispose: () => {
				void child.stdin.close().catch(() => {});
				child.kill();
			},
		};
	}
}

/** What keeps this machine awake for a worker: Windows' hold under WSL, else nothing. */
export function keepAwakeOf(ps: Ps, log: Logger): KeepAwake | null {
	return hostOf(ps) === "wsl2" ? new WindowsKeepAwake(ps, log) : null;
}
