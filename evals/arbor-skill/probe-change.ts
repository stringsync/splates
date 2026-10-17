import { execFile } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Probe } from "./probe";
import { hash } from "./probe-record";

const exec = promisify(execFile);
export interface SkillChange {
	baseline: string;
	skill: string;
	beforeHash: string;
	afterHash: string;
	files: string[];
}
/** Compare complete selected instruction bytes against an explicit immutable Git baseline, including dirty/untracked edits. */
export async function skillChange(
	skill: string,
	baseline?: string,
): Promise<SkillChange> {
	if (!baseline || baseline.startsWith("-")) {
		throw new Error(
			"Model execution requires --baseline REV for Arbor skill/reference changes",
		);
	}
	if ((await lstat(resolve(skill))).isSymbolicLink()) {
		throw new Error(
			"Symlinked skill sources are unsupported by the change gate",
		);
	}
	const source = await realpath(resolve(skill));
	const top = await git(source, ["rev-parse", "--show-toplevel"]);
	const path = relative(top, source);
	if (!path || path.startsWith("..") || isAbsolute(path)) {
		throw new Error("Skill must be a directory inside its Git repository");
	}
	// Reject links in ancestors as well as descendants: compare the tree we can actually identify.
	let ancestor = top;
	for (const part of path.split("/")) {
		ancestor = join(ancestor, part);
		if ((await lstat(ancestor)).isSymbolicLink()) {
			throw new Error(
				"Symlinked skill sources are unsupported by the change gate",
			);
		}
	}
	const commit = await git(top, [
		"rev-parse",
		"--verify",
		`${baseline}^{commit}`,
	]);
	const listing = await git(top, ["ls-tree", "-rz", commit, "--", path]);
	const before: Record<string, string> = {};
	for (const entry of listing.split("\0").filter(Boolean)) {
		const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
		if (!match || !["100644", "100755"].includes(match[1] ?? "")) {
			throw new Error("Unsupported baseline skill entry");
		}
		const name = relative(path, match[3] as string);
		if (!relevant(name)) {
			continue;
		}
		// Do not trim file bytes: a trailing newline is part of the instruction snapshot.
		before[name] = (
			await exec("git", ["cat-file", "blob", match[2] as string], {
				cwd: top,
				encoding: "buffer",
				maxBuffer: 8 * 1024 * 1024,
			})
		).stdout.toString("base64");
	}
	if (!before["SKILL.md"]) {
		throw new Error("Baseline has no readable SKILL.md at the selected path");
	}
	const after = await instructionFiles(source);
	if (!after["SKILL.md"]) {
		throw new Error("Selected source has no readable SKILL.md");
	}
	return {
		baseline: commit,
		skill: source,
		beforeHash: hash(before),
		afterHash: hash(after),
		files: [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((name) => before[name] !== after[name])
			.sort(),
	};
}
function relevant(name: string): boolean {
	return name === "SKILL.md" || name.startsWith("references/");
}
async function instructionFiles(
	source: string,
	prefix = "",
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const name of (await readdir(join(source, prefix))).sort()) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (path !== "references" && !relevant(path)) {
			continue;
		}
		const stat = await lstat(join(source, path));
		if (stat.isSymbolicLink()) {
			throw new Error(
				"Symlinked instructions are unsupported by the change gate",
			);
		}
		if (stat.isDirectory()) {
			Object.assign(files, await instructionFiles(source, path));
		} else if (stat.isFile()) {
			files[path] = (await readFile(join(source, path))).toString("base64");
		} else {
			throw new Error("Unsupported instruction file type");
		}
	}
	return files;
}

const smoke: Record<string, string> = {
	"SKILL.md": "discovery/implicit",
	"references/todos.md": "orchestration/dependency",
	"references/lanes.md": "orchestration/independent",
	"references/parts.md": "delegation/part-base",
	"references/handoff.md": "delegation/takeover",
	"references/checkpoint.md": "continuity/checkpoint",
	"references/setup.md": "discovery/setup",
	"references/systems.md": "decisions/system-proposal",
};
/** Default to at most two deterministic targeted cases; unmapped changes require explicit selection. */
export function smokeProbes(probes: Probe[], files: string[]): Probe[] {
	const ids = [
		...new Set(
			files.map((path) => {
				const id = smoke[path];
				if (!id) {
					throw new Error(
						`No smoke mapping for ${path}; select an explicit relevant --probe (budgets still apply)`,
					);
				}
				return id;
			}),
		),
	].slice(0, 2);
	return ids.map((id) => {
		const probe = probes.find((value) => value.id === id);
		if (!probe) {
			throw new Error(
				`Smoke probe ${id} is not registered; select an explicit --probe`,
			);
		}
		return probe;
	});
}

async function git(cwd: string, args: string[]): Promise<string> {
	return (
		await exec("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 })
	).stdout.trimEnd();
}
