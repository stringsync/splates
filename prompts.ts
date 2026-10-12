/** What a chat with an agent takes to mean todo `id`. */
export function todoReference(id: number): string {
	return `[ARBOR TODO #${id}]`;
}

/** What a chat with an agent takes to mean "work down lane `id`". */
export function laneReference(id: number): string {
	return `[ARBOR LANE ${id}]`;
}

/** What a chat with an agent takes to mean "claim `task` and carry on with it". */
export function taskReference(task: string): string {
	return `[ARBOR TASK ${task}]`;
}
