import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installScript } from "./box";
import { addKeyUrl } from "./move";
import { movedProjects } from "./paths";
import {
	type BoxProject,
	clonesScript,
	credsScript,
	KEYRING_RUN_SCRIPT,
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
			installScript("1.2.3", "KEY"),
			upgradeScript("1.2.3"),
			clonesScript(PROJECTS),
			placeScript(PROJECTS, "/home/splates/projects/splates"),
			credsScript(),
			refreshScript(),
			startScript(),
			KEYRING_RUN_SCRIPT,
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

	it("runs the server unlocked by the keyring password systemd hands it", () => {
		const unit = unitText("/home/splates/projects/splates");

		expect(unit).toContain("User=splates");
		expect(unit).toContain("LoadCredential=keyring:/root/splates-keyring");
		expect(unit).toContain(
			"ExecStart=/usr/local/lib/splates/keyring-run %d/keyring /home/splates/.bun/bin/splates server --port 4310",
		);
		expect(unit).toContain("Restart=always");
		expect(KEYRING_RUN_SCRIPT).toContain("dbus-run-session");
		expect(KEYRING_RUN_SCRIPT).toContain("gnome-keyring-daemon --unlock");
	});

	it("refreshes the unit keeping its directory, reloading systemd only when it changed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "splates-refresh-"));
		try {
			const unit = `${dir}/splates-coordinator.service`;
			const keyring = `${dir}/lib/keyring-run`;
			await writeFile(
				unit,
				"WorkingDirectory=/home/splates/projects/mine\nold\n",
			);
			await mkdir(`${dir}/bin`);
			// Stand-ins for the commands that would change the machine.
			for (const name of ["systemctl", "curl", "dpkg"]) {
				await writeFile(
					`${dir}/bin/${name}`,
					`#!/bin/sh\necho ${name} "$@" >> ${dir}/calls\n`,
					{ mode: 0o755 },
				);
			}
			const script = refreshScript()
				.replaceAll("/etc/systemd/system/splates-coordinator.service", unit)
				.replaceAll("/usr/local/lib/splates", `${dir}/lib`);
			const run = () =>
				Bun.spawnSync(["sh", "-c", script], {
					env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` },
				});

			expect(run().exitCode).toBe(0);
			expect(await readFile(unit, "utf8")).toBe(
				unitText("/home/splates/projects/mine").replaceAll(
					"/usr/local/lib/splates",
					`${dir}/lib`,
				),
			);
			expect(await readFile(keyring, "utf8")).toBe(KEYRING_RUN_SCRIPT);
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

	it("reads which projects push and which keys GitHub still lacks", () => {
		expect(
			readClones(
				"ready splates\nkey o'brien ssh-ed25519 AAAA splates-coordinator o'brien\n",
			),
		).toEqual({
			ready: ["splates"],
			keys: [
				{
					slug: "o'brien",
					key: "ssh-ed25519 AAAA splates-coordinator o'brien",
				},
			],
		});
	});

	it("links where GitHub adds a repository's deploy key", () => {
		expect(addKeyUrl("git@github.com:stringsync/splates.git")).toBe(
			"https://github.com/stringsync/splates/settings/keys/new",
		);
		expect(addKeyUrl("ssh://git@github.com/me/mdom")).toBe(
			"https://github.com/me/mdom/settings/keys/new",
		);
		expect(addKeyUrl("git@gitlab.com:me/x.git")).toBeNull();
	});
});
