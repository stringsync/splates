import { createContext, useContext, useEffect } from "react";
import type { Dictation } from "./dictation";

/**
 * The page's one dictation, which every composer's mic button records with:
 * null where the browser has no mic to give, as over plain HTTP.
 */
export const DictationContext = createContext<Dictation | null>(null);

/** Stops the page's active take before Escape reaches a menu or dialog. */
export function useEscapeStopsDictation(): void {
	const dictation = useContext(DictationContext);
	useEffect(() => {
		if (dictation === null) {
			return;
		}
		const press = (event: KeyboardEvent) => {
			const { phase } = dictation.state;
			if (
				event.key !== "Escape" ||
				event.isComposing ||
				(phase !== "asking" && phase !== "opening" && phase !== "recording")
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			void dictation.finish();
		};
		window.addEventListener("keydown", press, true);
		return () => window.removeEventListener("keydown", press, true);
	}, [dictation]);
}
