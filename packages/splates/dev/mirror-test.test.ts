import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recDir, recProblems } from "./mirror-test";

describe("the mirror test", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mirror-test-"));
	});

	afterEach(() => rm(dir, { recursive: true, force: true }));

	async function put(path: string, text: string) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), text);
	}

	async function whole() {
		await put("skill/SKILL.md", "skill");
		await put("control/index.html", "<html></html>");
		await put("control/styles.css", "");
		await put("control/main.tsx", "console.log('page');");
		await put(
			"extension/manifest.json",
			JSON.stringify({
				side_panel: { default_path: "panel.html" },
				background: { service_worker: "worker.js" },
				content_scripts: [{ js: ["open.js"] }],
			}),
		);
		for (const file of ["panel.html", "worker.js", "open.js"]) {
			await put(`extension/${file}`, "");
		}
	}

	it("passes a package with every file", async () => {
		await whole();
		expect(await recProblems(dir)).toEqual([]);
	});

	it("names a file the mirror left out", async () => {
		await whole();
		await rm(join(dir, "skill"), { recursive: true });
		await rm(join(dir, "extension/worker.js"));
		expect(await recProblems(dir)).toEqual([
			"missing skill/SKILL.md",
			"missing extension/worker.js",
		]);
	});

	it("fails a page script that does not build", async () => {
		await whole();
		await put("control/main.tsx", "import './gone';");
		const [problem] = await recProblems(dir);
		expect(problem).toContain("control/main.tsx did not build");
	});

	it("passes rec as this checkout holds it", async () => {
		expect(await recProblems(recDir())).toEqual([]);
	});
});
