import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import type { Moved } from "../coordinator";
import { coordinatorArea, type MovingProject } from "./area-coordinator";
import type { SetupMachine, SetupStep } from "./setup";

const HOME = "/home/.splates";
const PLIST = "/home/Library/LaunchAgents/dev.splates.worker.plist";

describe("COORDINATOR_AREA's move steps", () => {
	let fs: FakeFs;
	let machine: SetupMachine;
	let projects: MovingProject[];
	let answers: Moved[];
	let steps: Record<string, SetupStep>;

	beforeEach(() => {
		fs = new FakeFs();
		machine = { fs, home: HOME, device: new FakeSecretStore() };
		projects = [
			{
				slug: "app",
				root: "/code/app",
				remote: "origin",
				url: "git@github.com:me/app.git",
			},
		];
		answers = [];
		const area = coordinatorArea({
			projects: async () => projects,
			move: () => ({
				run: async ({ dryRun } = {}) => {
					expect(dryRun).toBe(true);
					const answer = answers.shift();
					if (answer === undefined) {
						throw new Error("cannot move yet:\n- no coordinator's box");
					}
					return answer;
				},
			}),
		});
		steps = Object.fromEntries(area.steps.map((step) => [step.id, step]));
	});

	it("lists the steps after the box in the order they are done", () => {
		expect(Object.keys(steps)).toEqual([
			"coordinator-cloud",
			"coordinator-box",
			"coordinator-remotes",
			"coordinator-keys",
			"coordinator-move",
		]);
		expect(steps["coordinator-keys"]?.after.map((each) => each.id)).toEqual([
			"coordinator-box",
			"coordinator-remotes",
			"tunnel",
		]);
	});

	it("reads the remotes done once every project names an SSH one", async () => {
		const remotes = steps["coordinator-remotes"] as SetupStep;
		expect(await remotes.check(machine)).toBe(true);
		expect(await remotes.detail?.(machine)).toBeNull();

		projects.push({
			slug: "site",
			root: "/code/site",
			remote: "origin",
			url: "https://github.com/me/site.git",
		});

		expect(await remotes.check(machine)).toBe(false);
		expect(await remotes.detail?.(machine)).toContain(
			"site's origin is https://github.com/me/site.git",
		);
	});

	it("reads the remotes not done with no project to move", async () => {
		projects = [];

		expect(await steps["coordinator-remotes"]?.check(machine)).toBe(false);
	});

	it("shows each key a dry run asks to add, and reads done once one is ready", async () => {
		const keys = steps["coordinator-keys"] as SetupStep;
		expect(await keys.check(machine)).toBe(false);
		expect(await keys.data?.(machine)).toBeNull();

		const key = {
			slug: "app",
			key: "ssh-ed25519 AAAA splates-coordinator app",
			add: "https://github.com/me/app/settings/keys/new",
		};
		answers.push({ status: "keys", keys: [key] });
		await keys.submit?.(machine, {});

		expect(await keys.check(machine)).toBe(false);
		expect(await keys.data?.(machine)).toEqual({ keys: [key] });

		answers.push({
			status: "ready",
			host: "splates.example.com",
			projects: ["app"],
		});
		await keys.submit?.(machine, {});

		expect(await keys.check(machine)).toBe(true);
		expect(await keys.data?.(machine)).toBeNull();
	});

	it("says what the move is missing when the dry run refuses", async () => {
		await expect(
			steps["coordinator-keys"]?.submit?.(machine, {}) ?? Promise.resolve(),
		).rejects.toThrow("no coordinator's box");
	});

	it("reads every step done once this Mac carries on as the box's worker", async () => {
		projects = [];
		expect(await steps["coordinator-move"]?.check(machine)).toBe(false);

		await fs.write(PLIST, "");

		expect(await steps["coordinator-keys"]?.check(machine)).toBe(true);
		expect(await steps["coordinator-move"]?.check(machine)).toBe(true);
	});
});
