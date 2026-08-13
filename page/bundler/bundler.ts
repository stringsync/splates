/**
 * Bundler turns an entry module and everything it imports into one script a
 * browser can run. Typically, this is assigned the variable name `bundler`.
 */
export interface Bundler {
	/** Throws with the build's own diagnostics when the entry does not compile. */
	bundle(entrypoint: string): Promise<string>;
}
