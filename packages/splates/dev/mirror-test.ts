import { dirname, join } from "node:path";

/** Throws unless rec's package in this checkout has everything it needs. */
export async function mirrorTest(dir: string = recDir()): Promise<void> {
	const problems = await recProblems(dir);
	if (problems.length > 0) {
		throw new Error(`rec is incomplete in ${dir}:\n${problems.join("\n")}`);
	}
}

/**
 * The files rec reads from disk, relative to its package: the ones
 * `sourceExtra` in `mirror.ts` lists, which tracing rec's imports cannot find.
 */
const REC_FILES = [
	"skill/SKILL.md",
	"control/index.html",
	"control/styles.css",
	"extension/manifest.json",
];

/** What rec's side panel extension loads, from its manifest. */
interface Manifest {
	side_panel?: { default_path?: string };
	background?: { service_worker?: string };
	content_scripts?: { js?: string[] }[];
}

/** Where rec's package is in this checkout, which in the mirror is where the release folded it in. */
export function recDir(from: string = import.meta.dir): string {
	return dirname(Bun.resolveSync("@mono/rec", from));
}

/**
 * What is missing or broken in rec's package at `dir`: the files it reads at
 * run time, everything its extension manifest names, and the control page's
 * script, which rec builds from `control/main.tsx` when it starts. Empty when
 * rec would run.
 */
export async function recProblems(dir: string): Promise<string[]> {
	const problems: string[] = [];
	const missing = async (path: string) => {
		if (!(await Bun.file(join(dir, path)).exists())) {
			problems.push(`missing ${path}`);
			return true;
		}
		return false;
	};
	for (const path of REC_FILES) {
		await missing(path);
	}
	if (!problems.includes("missing extension/manifest.json")) {
		const manifest: Manifest = await Bun.file(
			join(dir, "extension/manifest.json"),
		).json();
		const named = [
			manifest.side_panel?.default_path,
			manifest.background?.service_worker,
			...(manifest.content_scripts ?? []).flatMap((each) => each.js ?? []),
		];
		for (const file of named) {
			if (file !== undefined) {
				await missing(join("extension", file));
			}
		}
	}
	if (!(await missing("control/main.tsx"))) {
		const built = await Bun.build({
			entrypoints: [join(dir, "control/main.tsx")],
			target: "browser",
			throw: false,
		});
		if (!built.success) {
			problems.push(
				`control/main.tsx did not build:\n${built.logs.map(String).join("\n")}`,
			);
		}
	}
	return problems;
}
