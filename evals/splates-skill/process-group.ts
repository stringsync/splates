/** Wait for a terminated process group to disappear, rejecting if cleanup stalls. */
export async function awaitProcessGroupExit(
	pid: number | undefined,
	signals: Pick<NodeJS.Process, "kill"> = process,
): Promise<void> {
	// Pipe closure can precede the OS reaping a killed descendant.
	if (pid === undefined) {
		return;
	}
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			signals.kill(-pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") {
				return;
			}
			// Darwin can report EPERM while a killed group is being reaped.
			// Keep waiting for ESRCH; a persistent permission error still fails below.
			if ((error as NodeJS.ErrnoException).code !== "EPERM") {
				throw error;
			}
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Process group ${pid} did not exit after cleanup`);
}
