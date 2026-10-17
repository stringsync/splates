/** How long ago an ISO timestamp was, at the coarsest unit that still reads. */
export function age(since: string): string {
	const minutes = Math.floor((Date.now() - Date.parse(since)) / 60_000);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	if (minutes < 60 * 24) {
		return `${Math.floor(minutes / 60)}h`;
	}
	return `${Math.floor(minutes / (60 * 24))}d`;
}
