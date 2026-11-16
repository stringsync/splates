// Run by the new ship's `check`, from the mirror's root once the package is
// built: installs `packages/splates/dist` as npm would hand it out, in a
// folder of its own, and runs each command it puts on the PATH, so a build
// that leaves out a dependency or a file rec reads fails before it is
// published.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dist = resolve("packages/splates/dist");

/** What rec reads from beside its built code, relative to `dist`. */
const REC_FILES = [
	"extension/manifest.json",
	"skill/SKILL.md",
	"index.html",
	"control.js",
	"control.css",
];

const missing: string[] = [];
for (const path of REC_FILES) {
	if (!(await Bun.file(join(dist, path)).exists())) {
		missing.push(path);
	}
}
if (missing.length > 0) {
	throw new Error(`the build lacks what rec reads: ${missing.join(", ")}`);
}

const dir = await mkdtemp(join(tmpdir(), "splates-check-"));
try {
	await run(["npm", "pack", "--pack-destination", dir], dist);
	const [tarball] = [...new Bun.Glob("*.tgz").scanSync(dir)];
	if (!tarball) {
		throw new Error("npm pack made no tarball");
	}
	await Bun.write(join(dir, "package.json"), '{"private":true}');
	await run(["bun", "add", `./${tarball}`], dir);
	for (const bin of ["splates", "rec"]) {
		await run([join(dir, "node_modules/.bin", bin), "--help"], dir);
	}
	console.log("the installed build runs splates and rec");
} finally {
	await rm(dir, { recursive: true, force: true });
}

async function run(argv: string[], cwd: string): Promise<void> {
	const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) {
		throw new Error(
			`${argv.join(" ")} exited ${code}:\n${(out + err).slice(-2000)}`,
		);
	}
}
