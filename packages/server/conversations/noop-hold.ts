import type { Launcher } from "../agents";
import type { Hold } from "./host";

/** The place of an agent no worker placed: it is never lost, drained or replaced, and `resume` goes to the launcher. */
export class NoopHold implements Hold {
	readonly worker = "";
	readonly lost = new AbortController().signal;

	constructor(private readonly launcher: Launcher) {}

	drains(): boolean {
		return false;
	}

	replaces(): boolean {
		return false;
	}

	resume: Launcher["resume"] = (handle, held) =>
		this.launcher.resume(handle, held);

	dispose(): void {}
}
