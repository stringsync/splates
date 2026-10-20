import { createContext, useContext, useState } from "react";

/**
 * What a page read, kept for as long as the project's page is open, so a
 * page shown again starts on its last answer and reads afresh behind it,
 * rather than saying it is reading on every visit. Each page makes its own
 * the first time it is shown, so its code stays in the page's own chunk.
 */
export class PageReadings {
	private readonly held = new Map<string, unknown>();

	/** What `key` holds, made by `make` the first time it is asked for. */
	of<T>(key: string, make: () => T): T {
		if (!this.held.has(key)) {
			this.held.set(key, make());
		}
		return this.held.get(key) as T;
	}
}

export const PageReadingsContext = createContext<PageReadings | null>(null);

/**
 * What `key` holds across this page's visits, made by `make` on the first;
 * outside a `PageReadingsContext`, as in a page's own test, it lasts as the
 * component does.
 */
export function useReading<T>(key: string, make: () => T): T {
	const readings = useContext(PageReadingsContext);
	const [held] = useState(() =>
		readings === null ? make() : readings.of(key, make),
	);
	return held;
}
