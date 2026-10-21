import { describe, expect, it } from "bun:test";
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
