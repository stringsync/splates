import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type MakeSandbox,
	sandbox as plainSandbox,
	type Sandbox,
} from "@evals/evals/sandbox";
import type { Scenario as Base } from "@evals/evals/scenario";
import type { Scenario } from "./scenario";

export type { Scenario };

const splates = join(import.meta.dir, "../../../packages/splates/index.ts");

const INSTALLS = [".claude/skills/splates", ".agents/skills/splates"];

/**
 * Makes the sandbox each run of a splates scenario starts in, so the agent's
 * splates commands reach neither the person's server nor their tasks. Pass
 * every scenario of the batch: one marked `initialized` starts in a project
 * `splates init` has set up.
 */
export function splatesSandbox(scenarios: readonly Scenario[]): MakeSandbox {
	// A private splates home whose only agent can never start, and this
	// checkout's `splates` first on PATH.
	return async (skill, scenario) => {
		const initialized =
			scenarios.find((each) => each.id === scenario.id)?.initialized ?? false;
		const box = await plainSandbox(
			skill,
			async (repo) => {
				await repo.write(
					"splates.config.ts",
					'export default { preMerge: "true" };\n',
				);
				await scenario.seed?.(repo);
			},
			undefined,
		);
		try {
			return await prepare(box, skill, scenario, initialized);
		} catch (error) {
			await box.remove();
			throw error;
		}
	};
}

async function prepare(
	box: Sandbox,
	skill: string,
	scenario: Base,
	initialized: boolean,
): Promise<Sandbox> {
	const root = join(box.repo.dir, "..");
	const home = join(root, "splates-home");
	const bin = join(root, "bin");
	await Promise.all(
		[home, bin].map((each) => mkdir(each, { recursive: true })),
	);
	await writeFile(
		join(bin, "splates"),
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(splates)} "$@"\n`,
		{ mode: 0o755 },
	);
	await writeFile(
		join(home, "agents.json"),
		JSON.stringify({
			format: 1,
			agents: [{ id: "none", name: "No agent", argv: ["false"], models: [] }],
		}),
	);
	// `repo.run` and the agent share this object, so the changes reach both.
	for (const key of Object.keys(box.env)) {
		if (key.startsWith("SPLATES_") || key.startsWith("ARBOR_")) {
			delete box.env[key];
		}
	}
	Object.assign(box.env, {
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		SPLATES_HOME: home,
	});
	const { repo } = box;
	if (initialized) {
		await repo.run(["splates", "init"]);
		// init installs the released skill; the run is of the one given.
		for (const at of INSTALLS) {
			await rm(join(repo.dir, at), { recursive: true, force: true });
			await cp(skill, join(repo.dir, at), { recursive: true });
		}
		await repo.run(["git", "add", "-A"]);
		const staged = await repo.run(["git", "diff", "--cached", "--name-only"]);
		if (staged.trim() !== "") {
			await repo.run(["git", "commit", "-qm", "Initialize splates"]);
		}
	}
	await scenario.change?.(repo);
	return box;
}

function quote(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}
