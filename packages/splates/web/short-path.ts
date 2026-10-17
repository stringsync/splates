/** `path` with a home directory at its start read as `~`. */
export function shortPath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}
