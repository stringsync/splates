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

/** SQL for `col` in the range `under` gives, bound as `lo, hi, hi`. */
export function inRange(col: string): string {
	return `(${col} >= ? AND (? IS NULL OR ${col} < ?))`;
}

/** The parameters `inRange` binds. */
export function rangeParams(
	prefix: string,
): [string, string | null, string | null] {
	const { lo, hi } = under(prefix);
	return [lo, hi, hi];
}

/** The text of `data`, which a document or a record keeps as UTF-8. */
export function decode(data: Uint8Array): string {
	return new TextDecoder().decode(data);
}

export function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
