/**
 * `key` under `base`, refusing one that would reach outside it, so a key
 * built from what a user typed cannot name another storage's things.
 */
export function keyIn(base: string, key: string): string {
	if (key === "") {
		return base;
	}
	const parts = key.split("/");
	if (
		key.startsWith("/") ||
		parts.some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(`not a storage key: ${JSON.stringify(key)}`);
	}
	return base === "" ? key : `${base}/${key}`;
}

/** `name`, refusing one that is not a single part of a key. */
export function checkName(name: string): string {
	if (name === "" || name.includes("/") || name === "." || name === "..") {
		throw new Error(`not a name in a collection: ${JSON.stringify(name)}`);
	}
	return name;
}
