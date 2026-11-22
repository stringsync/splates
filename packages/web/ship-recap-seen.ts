const listeners = new Set<() => void>();

export function subscribeRecapSeen(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const KEY = "splates.ships.recap-seen";

/** The id of the last finished ship whose recap was shown. */
export function recapSeen(): string | null {
	return localStorage.getItem(KEY);
}

/** Records that the recap of run `id` was shown. */
export function markRecapSeen(id: string): void {
	localStorage.setItem(KEY, id);
	for (const listener of listeners) {
		listener();
	}
}
