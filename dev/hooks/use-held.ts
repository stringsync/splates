import { useEffect, useState } from "react";

/**
 * Whether ⌥⌘ (Ctrl+Alt off a Mac) is held down, to show the keys that go
 * with it. Leaving the window lets go, since its key-ups go elsewhere.
 */
export function useHeld(): boolean {
	const [held, setHeld] = useState(false);
	useEffect(() => {
		const check = (event: KeyboardEvent) =>
			setHeld(event.altKey && (event.metaKey || event.ctrlKey));
		const release = () => setHeld(false);
		window.addEventListener("keydown", check);
		window.addEventListener("keyup", check);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("keydown", check);
			window.removeEventListener("keyup", check);
			window.removeEventListener("blur", release);
		};
	}, []);
	return held;
}
