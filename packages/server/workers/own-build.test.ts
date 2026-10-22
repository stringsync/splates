import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { OWN_BUILD_HEADER, OWN_BUILD_WITHIN, OwnBuild } from "./own-build";

describe("OwnBuild", () => {
	let dir = "";
	let entry = "";

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-own-build-"));
		entry = join(dir, "index.ts");
		await writeFile(join(dir, "said.ts"), 'export const said = "built";\n');
		await writeFile(
			entry,
			'import { said } from "./said";\nconsole.log(said);\n',
		);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const ask = (build: OwnBuild, token: string | null) =>
		build.serve(
			new Request("http://splates/api/workers/join", {
				headers: token === null ? {} : { [OWN_BUILD_HEADER]: token },
			}),
		);

	it("serves its bundle, one runnable file, to a token it granted, as often as asked", async () => {
		const build = new OwnBuild({ entry, log: new MemoryLogger() });
		const token = build.grant();

		const first = await ask(build, token);
		const again = await ask(build, token);

		expect(first.status).toBe(200);
		const bundle = await first.text();
		expect(bundle.startsWith("#!/usr/bin/env bun\n")).toBe(true);
		expect(bundle).toContain('"built"');
		expect(await again.text()).toBe(bundle);
		const path = join(dir, "bundle.js");
		await writeFile(path, bundle);
		const ran = Bun.spawnSync(["bun", path]);
		expect(ran.stdout.toString()).toBe("built\n");
	});

	it("refuses no token, another, and one past its time", async () => {
		const wall = new FakeWallClock();
		const build = new OwnBuild({ entry, wall, log: new MemoryLogger() });
		const token = build.grant();

		expect((await ask(build, null)).status).toBe(401);
		expect((await ask(build, `${token}x`)).status).toBe(401);
		wall.advance(OWN_BUILD_WITHIN.add(Duration.secs(1)));
		expect((await ask(build, token)).status).toBe(401);
	});

	it("answers 503 when the bundle fails, and bundles again on the next ask", async () => {
		const log = new MemoryLogger();
		const build = new OwnBuild({ entry, log });
		const token = build.grant();
		await writeFile(entry, "export const = ;\n");

		const failed = await ask(build, token);
		await writeFile(entry, 'console.log("back");\n');
		const back = await ask(build, token);

		expect(failed.status).toBe(503);
		expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
			"could not bundle",
		);
		expect(back.status).toBe(200);
		expect(await back.text()).toContain('"back"');
	});
});
