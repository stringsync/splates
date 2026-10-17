/** Where this tab's id is kept: `sessionStorage` is the tab's own, and outlives a reload. */
const TAB = "arbor.tab";

/**
 * This browser tab's id, made the first time it is asked for and kept
 * through reloads, so what the server keeps per tab, such as its shells,
 * is found again by the same tab and by no other.
 */
export function tabId(): string {
	try {
		const kept = sessionStorage.getItem(TAB);
		if (kept !== null && kept !== "") {
			return kept;
		}
		const made = crypto.randomUUID();
		sessionStorage.setItem(TAB, made);
		return made;
	} catch {
		// Storage off: a tab that reloads gets fresh shells.
		return crypto.randomUUID();
	}
}
