import { useSyncExternalStore } from "react";

let offered: string | null = null;
const listeners = new Set<() => void>();

/**
 * Offers to bring conversation `id` back, in the inbox its archiving by swipe
 * leaves you in. Only one is offered: archiving another replaces it.
 */
export function offerUndo(id: string): void {
	set(id);
}

/** Withdraws the offer, as acting elsewhere does: no timer ends it. */
export function clearUndo(): void {
	if (offered !== null) {
		set(null);
	}
}

/** The conversation whose archiving is offered to be undone, or null. */
export function useUndoOffer(): string | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => offered,
	);
}

function set(id: string | null): void {
	offered = id;
	for (const listener of listeners) {
		listener();
	}
}
