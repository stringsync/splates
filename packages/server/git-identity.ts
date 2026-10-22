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
	const name = (await runner.git(cwd, ["config", "user.name"])).stdout.trim();
	const email = (await runner.git(cwd, ["config", "user.email"])).stdout.trim();
	return name === "" || email === "" ? null : { name, email };
}

/**
 * `-c` options naming `given`, else `splates`, for whichever of the name and
 * email the machine leaves unset: a configured one is never overridden.
 */
export async function fallbackIdentity(
	runner: GitRunner,
	cwd: string,
	given: Author | undefined,
): Promise<string[]> {
	const set = async (key: string) =>
		(await runner.git(cwd, ["config", key])).stdout.trim() !== "";
	const [name, email] = await Promise.all([
		set("user.name"),
		set("user.email"),
	]);
	const author = name && email ? null : await given?.author();
	return [
		...(name ? [] : ["-c", `user.name=${author?.name ?? "splates"}`]),
		...(email
			? []
			: ["-c", `user.email=${author?.email ?? "splates@localhost"}`]),
	];
}
