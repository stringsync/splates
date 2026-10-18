/** A comma-separated list, with empty values removed. */
export function commaList(raw: string): string[] {
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}
