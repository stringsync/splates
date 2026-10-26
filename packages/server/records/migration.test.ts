import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FileLock } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { Testing } from "../testing";
import { Format, type Migration as Step } from "./format";
import { Migration, type MigrationOptions } from "./migration";

describe("Migration", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
		await deps.fs.mkdir(deps.splatesDir, { recursive: true });
		await deps.fs.write(`${deps.splatesDir}/format`, "1\n");
	});

	afterEach(() => deps.disposeAsync());

	it("moves older records forward in its child and keeps no backup once done", async () => {
		const ran: string[] = [];
		const format = formatOf(deps, [step("splits lanes", ran)]);

		await migration(deps, format, () => format.migrate()).run();

		expect(ran).toEqual(["splits lanes"]);
		expect(await deps.fs.read(`${deps.splatesDir}/format`)).toBe("2\n");
		expect(await deps.fs.exists(`${deps.splatesDir}-backup`)).toBe(false);
		expect(await deps.fs.exists(`${deps.splatesDir}-migration.json`)).toBe(
			false,
		);
	});

	it("puts the records back as they were when a step fails, and keeps why", async () => {
		await deps.fs.write(`${deps.splatesDir}/lanes.json`, "[]\n");
		const ran: string[] = [];
		const format = formatOf(deps, [
			step("splits lanes", ran),
			step("renames tasks", ran, true),
		]);
		const failing = migration(deps, format, async () => {
			await deps.fs.rm(`${deps.splatesDir}/lanes.json`);
			await format.migrate();
		});

		await expect(failing.run()).toBail("migration_failed", {
			message: [
				"could not move from format 1 to 3 (renames tasks)",
				"renames tasks cut short",
				"bunx @stringsync/splates@0.0.47",
			],
		});

		expect(await deps.fs.read(`${deps.splatesDir}/format`)).toBe("1\n");
		expect(await deps.fs.read(`${deps.splatesDir}/lanes.json`)).toBe("[]\n");
		expect(await deps.fs.exists(`${deps.splatesDir}-backup`)).toBe(false);
		expect(await failing.failure()).toMatchObject({
			from: 1,
			to: 3,
			step: "renames tasks",
			release: "1.0.0",
			fallback: "0.0.47",
		});
	});

	it("stops a child still running past the limit, and puts the records back", async () => {
		const format = formatOf(deps, [step("splits lanes", [])]);
		let stopped = false;
		const hanging = migration(deps, format, null, {
			limit: Duration.ms(20),
			child: (signal) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => {
						stopped = true;
						resolve({ exitCode: 143, stderr: "" });
					});
				}),
		});

		await expect(hanging.run()).toBail("migration_failed", {
			message: ["still running after"],
		});
		expect(stopped).toBe(true);
		expect(await deps.fs.read(`${deps.splatesDir}/format`)).toBe("1\n");
	});

	it("refuses again without running a failure kept for this release, until asked to retry", async () => {
		const ran: string[] = [];
		const broken = formatOf(deps, [step("splits lanes", ran, true)]);
		const fixed = formatOf(deps, [step("splits lanes", ran)]);
		const run = (format: Format) =>
			migration(deps, format, () => format.migrate());

		await expect(run(broken).run()).toBail("migration_failed");
		await expect(run(broken).run()).toBail("migration_failed", {
			message: ["splits lanes cut short"],
		});
		expect(ran).toEqual(["splits lanes"]);

		await run(fixed).run({ retry: true });
		expect(ran).toEqual(["splits lanes", "splits lanes"]);
		expect(await run(fixed).failure()).toBeNull();
	});

	it("tries again on its own once another release runs", async () => {
		const ran: string[] = [];
		const format = formatOf(deps, [step("splits lanes", ran)]);
		await deps.fs.write(
			`${deps.splatesDir}-migration.json`,
			JSON.stringify({
				from: 1,
				to: 2,
				step: "splits lanes",
				error: "lanes are tangled",
				release: "0.9.0",
				fallback: null,
				at: "2026-10-20T00:00:00.000Z",
			}),
		);

		await migration(deps, format, () => format.migrate()).run();

		expect(ran).toEqual(["splits lanes"]);
		expect(await deps.fs.exists(`${deps.splatesDir}-migration.json`)).toBe(
			false,
		);
	});
});

function formatOf(deps: Testing, migrations: Step[]): Format {
	return new Format(deps.splatesDir, {
		fs: deps.fs,
		lock: new FileLock(`${deps.splatesDir}/format.lock`, {
			pidOnly: true,
			fs: deps.fs,
			ps: deps.ps,
			log: deps.log,
		}),
		log: deps.log,
		migrations,
	});
}

/**
 * A migration on release 1.0.0 whose child runs `steps` in this process,
 * saying a throw on stderr, unless `given` names a child of its own.
 */
function migration(
	deps: Testing,
	format: Format,
	steps: (() => Promise<void>) | null,
	given: Partial<Pick<MigrationOptions, "child" | "limit">> = {},
): Migration {
	return new Migration(format, {
		fs: deps.fs,
		log: deps.log,
		lock: new FileLock(`${deps.splatesDir}-migration.lock`, {
			pidOnly: true,
			fs: deps.fs,
			ps: deps.ps,
			log: deps.log,
		}),
		release: "1.0.0",
		child: () =>
			(steps ?? (async () => {}))().then(
				() => ({ exitCode: 0, stderr: "" }),
				(error: unknown) => ({ exitCode: 1, stderr: String(error) }),
			),
		...given,
	});
}

function step(does: string, ran: string[], cutShort = false): Step {
	return {
		does,
		run: async () => {
			ran.push(does);
			if (cutShort) {
				throw new Error(`${does} cut short`);
			}
		},
	};
}
