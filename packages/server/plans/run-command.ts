/** What runs splates: on the PATH, this repository's `bin/splates`, or bunx. */
const SPLATES = /^(?:\S*\/)?splates$|^@stringsync\/splates(?:@\S+)?$/;
/** Flags of `dev test` and `dev premerge` that scope a run below the whole suite. */
const SCOPING = new Set([
	"--changed",
	"--since",
	"--test-name-pattern",
	"--evals",
]);
/** `dev test`'s flags that take the word after them as their value. */
const VALUED = new Set(["--since", "--test-name-pattern", "--workers"]);

/**
 * Whether `command`, from a run-command card, runs the whole test suite: a
 * `splates dev test` with no scoping flag or file path, or a `splates dev
 * premerge` without `--evals`, which an agent is refused until the person
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
	if (which === "premerge") {
		return !rest.includes("--evals");
	}
	if (which !== "test") {
		return false;
	}
	for (let index = 0; index < rest.length; index++) {
		const word = rest[index] as string;
		const flag = word.split("=")[0] as string;
		if (SCOPING.has(flag)) {
			return false;
		}
		if (word.startsWith("-")) {
			if (VALUED.has(word)) {
				index++;
			}
			continue;
		}
		// A test file path.
		return false;
	}
	return true;
}
