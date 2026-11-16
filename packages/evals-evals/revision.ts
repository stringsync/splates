import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContractRevision } from "./contract";

/**
 * What a batch ran: the git commit the skill is at (when it is in a repo),
 * a hash of the skill as a sandbox installs it (everything but its top-level
 * `evals/`), and a hash of that `evals/` directory, the scenarios with their
 * checks and judge prompts.
 */
export async function revisionOf(skill: string): Promise<ContractRevision> {
	const installed = await hashOf(
		skill,
		await files(skill, (path) => path === "evals"),
	);
	let scenarios: string;
	try {
		const inEvals = await files(join(skill, "evals"), isInstalledDependency);
		scenarios = await hashOf(join(skill, "evals"), inEvals);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		scenarios = await hashOf(skill, []);
	}
	const git = Bun.spawnSync(["git", "-C", skill, "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const commit = git.exitCode === 0 ? git.stdout.toString().trim() : "";
	return {
		...(commit === "" ? {} : { commit }),
		skillHash: installed,
		scenarioHash: scenarios,
	};
}

/** Installed dependencies (often symlinks to directories) are not scenarios. */
function isInstalledDependency(relative: string): boolean {
	return relative.split("/").includes("node_modules");
}

/** Every file under `dir` as a sorted relative path, skipping those `skip` names. */
async function files(
	dir: string,
	skip: (relative: string) => boolean,
	prefix = "",
): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(join(dir, prefix), {
		withFileTypes: true,
	})) {
		const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (skip(relative)) {
			continue;
		}
		if (entry.isDirectory()) {
			found.push(...(await files(dir, skip, relative)));
		} else {
			found.push(relative);
		}
	}
	return found.sort();
}

/** One hash of the names and contents of `paths` under `dir`. */
async function hashOf(dir: string, paths: string[]): Promise<string> {
	const hash = createHash("sha256");
	for (const path of paths) {
		hash.update(`${path}\0`);
		hash.update(await readFile(join(dir, path)));
		hash.update("\0");
	}
	return hash.digest("hex");
}
