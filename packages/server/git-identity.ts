import type { GitRunner } from "./git";

/** A git author's name and email. */
export interface GitIdentity {
	name: string;
	email: string;
}

/** What names the author commits are signed as where the machine has none. */
export interface Author {
	author(): Promise<GitIdentity | null>;
}

/** The author `runner`'s git is configured with in `cwd`; null unless both name and email are set. */
export async function authorOf(
	runner: GitRunner,
	cwd: string,
): Promise<GitIdentity | null> {
	const { name, email } = await configured(runner, cwd);
	return name === "" || email === "" ? null : { name, email };
}

/**
 * The name and email git is configured with in `cwd`, each "" when unset,
 * read in one git call: a commit or rebase asks before every run.
 */
async function configured(
	runner: GitRunner,
	cwd: string,
): Promise<{ name: string; email: string }> {
	// Exits 1, printing nothing, when neither is set.
	const { stdout } = await runner.git(cwd, [
		"config",
		"--get-regexp",
		"^user\\.(name|email)$",
	]);
	const found = { name: "", email: "" };
	for (const line of stdout.split("\n")) {
		const space = line.indexOf(" ");
		const key = space === -1 ? line : line.slice(0, space);
		const value = space === -1 ? "" : line.slice(space + 1).trim();
		// The last of several values wins, as `git config <key>` reads it.
		if (key === "user.name") {
			found.name = value;
		} else if (key === "user.email") {
			found.email = value;
		}
	}
	return found;
}

/**
 * `-c` options naming `given`, else `splates`, for whichever of the name and
 * email the machine leaves unset: a configured one is never overridden.
 */
export async function fallbackIdentity(
	runner: GitRunner,
	cwd: string,
	given: Author,
): Promise<string[]> {
	const found = await configured(runner, cwd);
	const name = found.name !== "";
	const email = found.email !== "";
	const author = name && email ? null : await given.author();
	return [
		...(name ? [] : ["-c", `user.name=${author?.name ?? "splates"}`]),
		...(email
			? []
			: ["-c", `user.email=${author?.email ?? "splates@localhost"}`]),
	];
}
