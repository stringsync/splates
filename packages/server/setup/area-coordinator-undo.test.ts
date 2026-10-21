import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { FakeAws } from "../cloud/testing";
import type { Moved } from "../coordinator";
import { KeygenPs } from "../coordinator/testing";
import { coordinatorArea } from "./area-coordinator";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine, type SetupStep } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";
const KEY = `${HOME}/coordinator/id_ed25519`;

describe("undoing COORDINATOR_AREA", () => {
	let fs: FakeFs;
	let aws: FakeAws;
	let machine: SetupMachine;
	let area: ReturnType<typeof coordinatorArea>;

	beforeEach(async () => {
		fs = new FakeFs();
		aws = new FakeAws();
		aws.stock = ["t3.medium"];
		const ps = new KeygenPs(fs);
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		machine = {
			fs,
			ps,
			home: HOME,
			device: new FakeSecretStore(),
			fetch: aws.fetch,
		};
		const dryRun: Moved = {
			status: "ready",
			host: "splates.example.com",
			projects: [],
		};
		area = coordinatorArea({
			projects: async () => [
				{
					slug: "app",
					root: "/code/app",
					remote: "origin",
					url: "git@github.com:me/app.git",
				},
			],
			move: () => ({ run: async () => dryRun }),
		});
	});

	function setup() {
		return new Setup(machine, [REMOTE_ACCESS_AREA, area]);
	}

	function step(id: string): SetupStep {
		return area.steps.find((each) => each.id === id) as SetupStep;
	}

	it("plans destroying the box, named to go ahead, and leaves the deploy keys to the person", async () => {
		await step("coordinator-box").submit?.(machine, {});
		await step("coordinator-keys").submit?.(machine, {});

		const plan = await setup().undoPlan("coordinator");

		expect(plan.steps).toEqual([
			{
				id: "coordinator-keys",
				title: "Let the box push each project",
				done: true,
				removes: [],
				leaves: [
					"`app`'s deploy key for the box in the repository's **Settings → Deploy keys** on GitHub.",
				],
			},
			{
				id: "coordinator-remotes",
				title: "Name each project's remote",
				done: true,
				removes: [],
				leaves: [expect.stringContaining('`remote: "origin"`')],
			},
			{
				id: "coordinator-box",
				title: "Make the server's box",
				done: true,
				removes: [
					"The AWS server `splates-coordinator`, and with it every backup AWS keeps of it",
					"The AWS firewall `splates-coordinator`",
					"The AWS SSH key `splates-coordinator`, and its key pair here, `~/.splates/coordinator/id_ed25519`",
				],
				leaves: [],
			},
		]);
		expect(plan.confirm).toBe("splates-coordinator");
		expect(plan.creds).toEqual([]);
		expect(plan.refused).toBeNull();
	});

	it("destroys the box, its firewall and keys once its name is typed, and again finds nothing to do", async () => {
		const box = step("coordinator-box");
		await box.submit?.(machine, {});
		await expect(setup().undo("coordinator", "splates")).rejects.toThrow(
			"Type splates-coordinator to undo Cloud server.",
		);

		await box.undo?.run(machine);
		await box.undo?.run(machine);

		expect(aws.instances.size).toBe(0);
		expect(aws.groups.size).toBe(0);
		expect(aws.keys.size).toBe(0);
		expect(await fs.exists(KEY)).toBe(false);
		expect(await fs.exists(`${KEY}.pub`)).toBe(false);
		expect(await box.check(machine)).toBe(false);
	});

	it("forgets the last dry run once undone", async () => {
		await step("coordinator-box").submit?.(machine, {});
		await step("coordinator-keys").submit?.(machine, {});

		await setup().undo("coordinator", "splates-coordinator");

		expect(await step("coordinator-keys").check(machine)).toBe(false);
		expect(await step("coordinator-box").check(machine)).toBe(false);
	});

	it("refuses every step once the server has moved onto its box", async () => {
		await fs.write(UNIT, "");
		const refusal =
			"splates server runs on its box now, holding the only live records; move it back first (task #385).";

		expect((await setup().undoPlan("coordinator")).refused).toBe(refusal);
		await expect(
			setup().undo("coordinator", "splates-coordinator"),
		).rejects.toThrow(refusal);
		expect(aws.requests).toEqual([]);
	});
});
