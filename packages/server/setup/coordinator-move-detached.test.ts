import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detached, moveFiles } from "./coordinator-move";

/** Waits until the file `$1` is there. */
const WAIT = 'while [ ! -f "$1" ]; do sleep 0.05; done';

describe("detached", () => {
	it("returns at once, the command logging and writing its exit code once it ends", async () => {
		const dir = await mkdtemp(`${tmpdir()}/splates-move-`);
		try {
			const files = moveFiles(dir);
			await Bun.$`mkdir -p ${dir}/coordinator`;
			const line = detached(
				["sh", "-c", 'sleep 0.2; echo "it\'s moving"; kill -INT $$; exit 3'],
				files,
			);

			const started = Date.now();
			await Bun.$`sh -c ${line}`;
			expect(Date.now() - started).toBeLessThan(150);

			await Bun.$`sh -c ${WAIT} sh ${files.exit}`;
			expect(await readFile(files.log, "utf8")).toBe("it's moving\n");
			expect((await readFile(files.exit, "utf8")).trim()).toBe("3");
			expect(Number(await readFile(files.pid, "utf8"))).toBeGreaterThan(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
