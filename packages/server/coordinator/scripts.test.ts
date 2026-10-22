import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { movedProjects } from "./paths";
import {
	type BoxProject,
	clonesScript,
	needsScript,
	placeScript,
	readClones,
	refreshScript,
	startScript,
	unitText,
	upgradeScript,
} from "./scripts";

const PROJECTS: BoxProject[] = movedProjects([
	{ slug: "splates", root: "/Users/me/Projects/splates" },
	{ slug: "o'brien", root: "/Users/me/Projects/o'brien" },
]).map((each) => ({
	...each,
	url: `git@github.com:me/${each.slug}.git`,
	trunk: "main",
}));

/** Whether `sh` parses `script`, without running it. */
function parses(script: string): string {
	const ran = Bun.spawnSync(["sh", "-n"], { stdin: Buffer.from(script) });
	return ran.stderr.toString();
}

describe("the box's scripts", () => {
	it("all parse as sh, quotes in a project's name and all", () => {
		const scripts = [
			upgradeScript("1.2.3"),
			clonesScript(PROJECTS),
			placeScript(PROJECTS, "/home/splates/projects/splates"),
			needsScript(PROJECTS),
			refreshScript(),
			startScript(),
		];

		expect(scripts.map(parses)).toEqual(scripts.map(() => ""));
	});

	it("hands the box's user a script that parses too", () => {
		// Run as sh would, but with what `su` runs only parsed.
		const inner = clonesScript(PROJECTS).replace("su - splates -c ", "sh -nc ");
		const ran = Bun.spawnSync(["sh", "-c", inner]);

		expect(ran.stderr.toString()).toBe("");
		expect(ran.exitCode).toBe(0);
	});

	it("runs the server reading its creds from Parameter Store, with no keyring", () => {
		const unit = unitText("/home/splates/projects/splates");

		expect(unit).toContain("User=splates");
		expect(unit).toContain("Environment=SPLATES_SECRET_STORE=ssm");
		expect(unit).toContain(
			"ExecStart=/home/splates/.bun/bin/splates server --port 7272",
		);
		expect(unit).toContain("Restart=always");
		expect(unit).not.toContain("keyring");
	});

	it("asks the box for what it lacks, and reads each deploy key from its store", () => {
		expect(needsScript(PROJECTS)).toContain(
			"SPLATES_SECRET_STORE=ssm /home/splates/.bun/bin/splates server needs",
		);
		expect(clonesScript(PROJECTS)).toContain("server deploy-key");
		expect(clonesScript(PROJECTS)).not.toContain("ssh-keygen");
	});

	it("refreshes the unit keeping its directory, reloading systemd only when it changed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "splates-refresh-"));
		try {
			const unit = `${dir}/splates-coordinator.service`;
			await writeFile(
				unit,
				"WorkingDirectory=/home/splates/projects/mine\nold\n",
			);
			await mkdir(`${dir}/bin`);
			// Stand-ins for the commands that would change the machine.
			await Promise.all(
				["systemctl", "curl", "dpkg"].map((name) =>
					writeFile(
						`${dir}/bin/${name}`,
						`#!/bin/sh\necho ${name} "$@" >> ${dir}/calls\n`,
						{ mode: 0o755 },
					),
				),
			);
			const script = refreshScript().replaceAll(
				"/etc/systemd/system/splates-coordinator.service",
				unit,
			);
			const run = () =>
				Bun.spawnSync(["sh", "-c", script], {
					env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` },
				});

			expect(run().exitCode).toBe(0);
			expect(await readFile(unit, "utf8")).toBe(
				unitText("/home/splates/projects/mine"),
			);
			expect(await readFile(`${dir}/calls`, "utf8")).toContain(
				"systemctl daemon-reload",
			);

			await rm(`${dir}/calls`);
			expect(run().exitCode).toBe(0);
			expect(await readFile(`${dir}/calls`, "utf8")).not.toContain(
				"daemon-reload",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reads which projects push and which the box is refused", () => {
		expect(readClones("ready splates\nrefused o'brien\n")).toEqual({
			ready: ["splates"],
			refused: ["o'brien"],
		});
	});
});
