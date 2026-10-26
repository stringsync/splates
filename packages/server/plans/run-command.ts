/** What runs splates: on the PATH, this repository's `bin/splates`, or bunx. */
const SPLATES = /^(?:\S*\/)?splates$|^@stringsync\/splates(?:@\S+)?$/;
/**
 * Whether `command`, from a run-command card, may need a suite grant: a
 * `splates dev test` (including scopes reaching half the test files), or a
 * `splates dev premerge` without `--evals`, which an agent is refused until the person
 * approves one run. Leading `VAR=value` words and `bunx` are passed over.
 */
export function isWholeSuite(command: string): boolean {
	const words = command.trim().split(/\s+/);
	let at = 0;
	while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at] ?? "")) {
		at++;
	}
	if (words[at] === "bunx") {
		at++;
	}
	if (!SPLATES.test(words[at] ?? "") || words[at + 1] !== "dev") {
		return false;
	}
	const which = words[at + 2];
	const rest = words.slice(at + 3);
	return (
		(which === "test" || which === "premerge") && !rest.includes("--evals")
	);
}
