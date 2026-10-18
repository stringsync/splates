import { useState } from "react";

/**
 * Which of a list's groups are folded away, by key, as this browser keeps
 * them under `storage`: the Tasks page's projects, the sidebar's folders.
 * `fold(key, open)` opens or folds one and keeps it.
 */
export function useFolded(storage: string): {
	folded: ReadonlySet<string>;
	fold: (key: string, open: boolean) => void;
} {
	const [folded, setFolded] = useState(() => foldedIn(storage));
	const fold = (key: string, open: boolean) => {
		const next = new Set(folded);
		if (open) {
			next.delete(key);
		} else {
			next.add(key);
		}
		try {
			localStorage.setItem(storage, JSON.stringify([...next]));
		} catch {
			// Storage refused, as in a private window: it stays folded until a reload.
		}
		setFolded(next);
	};
	return { folded, fold };
}

function foldedIn(storage: string): Set<string> {
	try {
		const read: unknown = JSON.parse(localStorage.getItem(storage) ?? "[]");
		return new Set(
			Array.isArray(read)
				? read.filter((each) => typeof each === "string")
				: [],
		);
	} catch {
		return new Set();
	}
}
