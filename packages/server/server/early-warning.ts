/**
 * What `ConflictWatch` tells a task's working agent, the page drawing each as
 * an event line rather than a message: `words` under a line naming the task.
 */
export function earlyWarning(task: string, words: string): string {
	return `Splates early warning for ${task}:\n\n${words}`;
}

/** The words of an early warning that the task's commits conflict with its base. */
export function conflictWarning(
	base: string,
	files: readonly string[],
): string {
	return `The committed changes will conflict with ${base} in: ${files.join(", ")}. Align the changes before merging. This check did not rebase or change your worktree.`;
}
