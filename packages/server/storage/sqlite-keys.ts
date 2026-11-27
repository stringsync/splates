/**
 * The bounds on a `key` column of everything under `prefix`, a key with no
 * trailing `/`, for a `BETWEEN`-shaped range an index can serve: `lo` is
 * `prefix/`, and `hi` the first key past it, or null under the root, where
 * nothing is past.
 */
export function under(prefix: string): { lo: string; hi: string | null } {
	if (prefix === "") {
		return { lo: "", hi: null };
	}
	return {
		lo: `${prefix}/`,
		hi: `${prefix}${String.fromCharCode("/".charCodeAt(0) + 1)}`,
	};
}

/**
 * SQL for `col` in the range `under` gives, with its bound parameters.
 * Empty prefix matches every row with no parameters; a non-empty prefix uses
 * a tight `>= ? AND < ?` range so SQLite can apply both index bounds.
 */
export function rangeOf(
	col: string,
	prefix: string,
): { sql: string; params: string[] } {
	if (prefix === "") {
		return { sql: "1 = 1", params: [] };
	}
	const { lo, hi } = under(prefix);
	return { sql: `(${col} >= ? AND ${col} < ?)`, params: [lo, hi as string] };
}

/** The text of `data`, which a document or a record keeps as UTF-8. */
export function decode(data: Uint8Array): string {
	return new TextDecoder().decode(data);
}

export function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
