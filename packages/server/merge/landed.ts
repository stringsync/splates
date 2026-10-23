import { posix } from "node:path";
import type { Git } from "../git";
import type { LandedCommit, LandedSince } from "../records";
import type { FinishedTask } from "../tasks";
import type { FailingCase } from "./test-report";

/** Past this many, a range the filter left empty is told as a count alone. */
const WHOLE_RANGE_MAX = 10;

const IMPORT =
	/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/**
 * What landed on the base between the task's last base and the one it was
 * just tested on: the commits touching the failing test files, what they
 * import, or what the task changed. When none does, the whole range if it is
 * short, so a semantic conflict with something that just landed reads as one.
 * Null when the base had not moved.
 */
export async function landedSince(
	{
		git,
		finished,
	}: { git: Git; finished: { list(): Promise<FinishedTask[]> } },
	{
		cwd,
		from,
		to,
		head,
		failing,
	}: {
		cwd: string;
		/** The base the branch sat on before the merge rebased it, null when unknown. */
		from: string | null;
		/** The base it was rebased onto and tested against. */
		to: string;
		/** The tested commit, the task on `to`. */
		head: string;
		failing: FailingCase[];
	},
): Promise<LandedSince | null> {
	if (from === null || from === to) {
		return null;
	}
	// Only repository paths make a pathspec; a runner that reports others
	// still gets the files the task changed.
	const tests = [
		...new Set(
			failing
				.flatMap((each) => (each.file === undefined ? [] : [each.file]))
				.map((file) => file.replace(/^\.\//, ""))
				.filter((file) => !file.startsWith("/") && !file.startsWith("..")),
		),
	];
	try {
		return await between(git, cwd, { from, to, head, tests }, finished);
	} catch {
		// Naming what landed is a hint: a failure to read it leaves the message as it was.
		return null;
	}
}

async function between(
	git: Git,
	cwd: string,
	{
		from,
		to,
		head,
		tests,
	}: { from: string; to: string; head: string; tests: string[] },
	finished: { list(): Promise<FinishedTask[]> },
): Promise<LandedSince | null> {
	const range = `${from}..${to}`;
	const total = Number(await git.out(cwd, "rev-list", "--count", range));
	if (!(total > 0)) {
		return null;
	}
	const landedAs = landedTasks(await finished.list());
	const changed = (await git.out(cwd, "diff", "--name-only", `${to}..${head}`))
		.split("\n")
		.filter(Boolean);
	const imported = await importedBy(git, cwd, head, tests);
	const paths = [...new Set([...tests, ...imported, ...changed])];
	const touching =
		paths.length === 0 ? [] : await commits(git, cwd, range, landedAs, paths);
	if (touching.length > 0) {
		return { from, to, total, filtered: true, commits: touching };
	}
	return {
		from,
		to,
		total,
		filtered: false,
		commits:
			total < WHOLE_RANGE_MAX
				? await commits(git, cwd, range, landedAs, [])
				: [],
	};
}

/** The block a `tests_failed` message shows of `landed`, or no lines when nothing landed. */
export function landedLines(
	base: string,
	landed: LandedSince | null,
): string[] {
	if (landed === null) {
		return [];
	}
	const head = `Since your last base (${landed.from.slice(0, 8)}), ${base} moved to ${landed.to.slice(0, 8)}, ${landed.total} commit(s).`;
	const listed = landed.commits.map(
		(each) => `  ${each.commit} ${each.task ?? "-"} ${each.subject}`,
	);
	if (landed.filtered) {
		return [
			`${head} Landed commits touching the failing test files, what they import, or files you changed:`,
			...listed,
			"Read these before the test: a change that just landed is the likeliest cause.",
			"",
		];
	}
	return listed.length > 0
		? [
				`${head} None touched the failing test files, what they import, or files you changed; all of them:`,
				...listed,
				"",
			]
		: [
				`${head} None touched the failing test files, what they import, or files you changed (\`git log ${landed.from.slice(0, 8)}..${landed.to.slice(0, 8)}\` lists them).`,
				"",
			];
}

/** The task each finished task's landed commit came from, by its short sha. */
function landedTasks(
	finished: { task: string; commit: string | null }[],
): Map<string, string> {
	const map = new Map<string, string>();
	for (const each of finished) {
		if (each.commit !== null && !map.has(each.commit)) {
			map.set(each.commit, each.task);
		}
	}
	return map;
}

async function commits(
	git: Git,
	cwd: string,
	range: string,
	landedAs: Map<string, string>,
	paths: string[],
): Promise<LandedCommit[]> {
	const out = await git.out(
		cwd,
		"log",
		"--format=%H%x09%s",
		range,
		...(paths.length > 0 ? ["--", ...paths] : []),
	);
	return out
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sha = "", subject = ""] = line.split("\t");
			const short = sha.slice(0, 8);
			let task: string | null = null;
			for (const [commit, slug] of landedAs) {
				if (commit.length >= 7 && sha.startsWith(commit)) {
					task = slug;
					break;
				}
			}
			return { commit: short, task, subject };
		});
}

/**
 * The repository paths the files import by a relative specifier, one level
 * deep. Each extensionless one is given as the files it may resolve to, which
 * as a pathspec match nothing when they do not exist.
 */
async function importedBy(
	git: Git,
	cwd: string,
	head: string,
	files: string[],
): Promise<string[]> {
	const found = new Set<string>();
	for (const file of files) {
		const source = await git
			.out(cwd, "show", `${head}:${file}`)
			.catch(() => "");
		for (const [, specifier = ""] of source.matchAll(IMPORT)) {
			const path = posix.normalize(posix.join(posix.dirname(file), specifier));
			if (path.startsWith("..")) {
				continue;
			}
			if (posix.extname(path) !== "") {
				found.add(path);
				continue;
			}
			for (const suffix of [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
				found.add(`${path}${suffix}`);
			}
		}
	}
	return [...found];
}
