/** Remove inline media bytes while retaining tool results, MIME types and paths. */
export function withoutMedia(text: string): string {
	const urls = text.replace(
		/data:(?:image|audio|video)\/[^;,\s]+;base64,[A-Za-z0-9+/=\r\n]+/g,
		"[inline media omitted]",
	);
	try {
		return JSON.stringify(JSON.parse(urls), (_key, value: unknown) => {
			if (
				value !== null &&
				typeof value === "object" &&
				"type" in value &&
				value.type === "base64" &&
				"data" in value
			) {
				return { ...value, data: "[inline media omitted]" };
			}
			return value;
		});
	} catch {
		// Some providers emit several JSON content blocks separated by newlines.
		return urls.replace(
			/("type"\s*:\s*"base64"[^{}]*?"data"\s*:\s*")[^"]+(")/g,
			"$1[inline media omitted]$2",
		);
	}
}
