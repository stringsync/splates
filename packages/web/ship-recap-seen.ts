import { useEffect, useState } from "react";

const KEY = "splates.ships.acknowledged";
const CHANGED = "splates:ship-acknowledged";

/** The id of the last ship whose recap the person acknowledged. */
export function acknowledged(): string | null {
	return localStorage.getItem(KEY);
}

/** Records that the person has seen `id`'s recap, for every view of it on the page. */
export function acknowledge(id: string): void {
	localStorage.setItem(KEY, id);
	window.dispatchEvent(new Event(CHANGED));
}

/** The id of the last acknowledged ship, kept as it changes. */
export function useAcknowledged(): string | null {
	const [id, setId] = useState(acknowledged);
	useEffect(() => {
		const sync = () => setId(acknowledged());
		window.addEventListener(CHANGED, sync);
		window.addEventListener("storage", sync);
		return () => {
			window.removeEventListener(CHANGED, sync);
			window.removeEventListener("storage", sync);
		};
	}, []);
	return id;
}
