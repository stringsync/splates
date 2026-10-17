import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { Fixture } from "./fixture";

describe("Fixture.turn", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	/** A fixture whose `claude` is `script`, a shell script, with no repository seeded. */
	async function fixtureRunning(script: string): Promise<Fixture> {
		const dir = await mkdtemp(join(tmpdir(), "fixture-test-"));
		dirs.push(dir);
		await mkdir(join(dir, "bin"));
		await mkdir(join(dir, "repo"));
		await writeFile(join(dir, "bin", "claude"), `#!/bin/sh\n${script}\n`, {
			mode: 0o755,
		});
		return new Fixture(dir, dir, new NodePs());
	}

	it("returns what the agent printed when it finishes within the limit", async () => {
		const fixture = await fixtureRunning(`echo '{"type":"result"}'`);
		expect(
			await fixture.turn("go", { model: "opus", limit: Duration.secs(10) }),
		).toEqual({ lines: ['{"type":"result"}'], timedOut: false });
	});

	it("stops an agent at the limit with everything it started, keeping what it printed", async () => {
		const fixture = await fixtureRunning(
			`echo '{"type":"system"}'\n(while true; do sleep 0.1; done; ) &\necho $! > "$PWD/../child"\nwait`,
		);
		const turn = await fixture.turn("go", {
			model: "opus",
			limit: Duration.ms(500),
		});
		expect(turn).toEqual({ lines: ['{"type":"system"}'], timedOut: true });
		const child = Number(await readFile(join(fixture.dir, "child"), "utf8"));
		expect(new NodePs().alive(child)).toBe(false);
	});
});
