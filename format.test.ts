import { describe, expect, it } from "bun:test";
import { FileLock } from "webappwiz/system";
import { FORMAT, Format, type Migration } from "./format";
import { Testing } from "./testing";

/** A `Format` over the test's records, moved on by `migrations`. */
function format(deps: Testing, migrations: readonly Migration[]): Format {
	return new Format(deps.arborDir, {
		fs: deps.fs,
		lock: new FileLock(`${deps.arborDir}/format.lock`, {
			fs: deps.fs,
			ps: deps.ps,
			log: deps.log,
			pollMs: 5,
		}),
		log: deps.log,
		migrations,
	});
}

/** A step that notes each run in `ran`, failing on its first run when `flaky`. */
function step(name: string, ran: string[], flaky = false): Migration {
	let runs = 0;
	return {
		does: name,
		async run() {
			runs += 1;
			ran.push(name);
			if (flaky && runs === 1) {
				throw new Error(`${name} cut short`);
			}
		},
	};
}

describe("Format", () => {
	it("refuses a repository arbor init never ran in, and stamps it as this arbor's on create", async () => {
		await using deps = await Testing.open({ init: false });
		const later = format(deps, [step("splits lanes", [])]);

		await expect(later.check()).toBail("uninitialized", {
			message: "Run `arbor init` in it once",
		});
		await expect(later.migrate()).toBail("uninitialized");
		expect(await deps.fs.exists(deps.arborDir)).toBe(false);

		await later.create();
		await later.check();
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("2\n");
	});

	it("stamps records from before formats as version 1 on create, and leaves stamped ones alone", async () => {
		await using deps = await Testing.open({ init: false });
		await deps.fs.mkdir(`${deps.arborDir}/tasks`);

		await format(deps, [step("splits lanes", [])]).create();
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("1\n");

		await deps.format.create();
		expect(FORMAT).toBe(1);
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("1\n");
	});

	it("moves older records forward a step at a time, in order, saying each", async () => {
		await using deps = await Testing.open();
		const ran: string[] = [];
		const steps = [step("splits lanes", ran), step("renames tasks", ran)];

		await format(deps, steps).migrate();

		expect(ran).toEqual(["splits lanes", "renames tasks"]);
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("3\n");
		expect(deps.out()).toContain(
			"migrating arbor's records to format 2: splits lanes",
		);
		expect(deps.out()).toContain(
			"migrating arbor's records to format 3: renames tasks",
		);

		await format(deps, steps).migrate();
		expect(ran).toHaveLength(2);
	});

	it("runs only the steps past the stored format", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, "2\n");
		const ran: string[] = [];

		await format(deps, [
			step("splits lanes", ran),
			step("renames tasks", ran),
		]).migrate();

		expect(ran).toEqual(["renames tasks"]);
	});

	it("starts again from a step cut short", async () => {
		await using deps = await Testing.open();
		const ran: string[] = [];
		const steps = [step("splits lanes", ran), step("renames tasks", ran, true)];

		await expect(format(deps, steps).migrate()).rejects.toThrow(
			"renames tasks cut short",
		);
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("2\n");

		await format(deps, steps).migrate();
		expect(ran).toEqual(["splits lanes", "renames tasks", "renames tasks"]);
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("3\n");
	});

	it("runs each step once when two commands meet older records at once", async () => {
		await using deps = await Testing.open();
		const ran: string[] = [];
		const steps = [step("splits lanes", ran), step("renames tasks", ran)];

		await Promise.all([
			format(deps, steps).migrate(),
			format(deps, steps).migrate(),
		]);

		expect(ran).toEqual(["splits lanes", "renames tasks"]);
	});

	it("refuses older records until arbor dev has migrated them", async () => {
		await using deps = await Testing.open();
		const ran: string[] = [];
		const older = format(deps, [step("splits lanes", ran)]);

		await expect(older.check()).toBail("outdated", {
			message: [
				"format 1, older than this arbor's 2",
				"Start `arbor dev` in this repository once",
			],
		});
		expect(ran).toEqual([]);
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe("1\n");

		await older.migrate();
		await older.check();
	});

	it("refuses records a newer arbor wrote, and says to run the latest", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, `${FORMAT + 1}\n`);

		await expect(deps.format.check()).toBail("outdated", {
			message: [
				`format ${FORMAT + 1}, written by a newer arbor`,
				"bunx @webappwiz/arbor@latest",
			],
		});
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe(
			`${FORMAT + 1}\n`,
		);
	});

	it("refuses a format file that names no format", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, "soon\n");

		await expect(deps.format.check()).toBail("usage", {
			message: ["names no format: 'soon'"],
		});
	});
});
