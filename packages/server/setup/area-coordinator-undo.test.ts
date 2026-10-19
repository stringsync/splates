import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, HCLOUD_TOKEN } from "../cloud";
import { FakeHetzner } from "../cloud/testing";
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
	let hetzner: FakeHetzner;
	let machine: SetupMachine;
	let area: ReturnType<typeof coordinatorArea>;

	beforeEach(async () => {
		fs = new FakeFs();
		hetzner = new FakeHetzner();
		hetzner.stock = { ash: ["cpx21"] };
		machine = {
			fs,
			ps: new KeygenPs(fs),
			home: HOME,
			device: new FakeSecretStore(),
			fetch: hetzner.fetch,
		};
		await machine.device.set(HCLOUD_TOKEN, "token");
		await new ChosenCloud(HOME, fs).choose("hetzner");
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
				removes: [],
				leaves: [
					"`app`'s deploy key for the box in the repository's **Settings → Deploy keys** on GitHub.",
				],
			},
			{
				id: "coordinator-remotes",
				title: "Name each project's remote",
				removes: [],
				leaves: [expect.stringContaining('`remote: "origin"`')],
			},
			{
				id: "coordinator-box",
				title: "Make the server's box",
				removes: [
					"The Hetzner Cloud server `splates-coordinator`, and with it every backup Hetzner Cloud keeps of it",
					"The Hetzner Cloud firewall `splates-coordinator`",
					"The Hetzner Cloud SSH key `splates-coordinator`, and its key pair here, `~/.splates/coordinator/id_ed25519`",
				],
				leaves: [],
			},
			{
				id: "coordinator-cloud",
				title: "Choose a cloud provider",
				removes: ["The cloud provider chosen, kept in `~/.splates/cloud.json`"],
				leaves: [],
			},
		]);
		expect(plan.confirm).toBe("splates-coordinator");
		expect(plan.creds).toEqual([{ name: HCLOUD_TOKEN, keptFor: null }]);
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

		expect(hetzner.servers.size).toBe(0);
		expect(hetzner.firewalls.size).toBe(0);
		expect(hetzner.sshKeys.size).toBe(0);
		expect(await fs.exists(KEY)).toBe(false);
		expect(await fs.exists(`${KEY}.pub`)).toBe(false);
		expect(await box.check(machine)).toBe(false);
	});

	it("forgets the token, the cloud chosen and the last dry run once undone", async () => {
		await step("coordinator-box").submit?.(machine, {});
		await step("coordinator-keys").submit?.(machine, {});

		await setup().undo("coordinator", "splates-coordinator");

		expect(await machine.device.get(HCLOUD_TOKEN)).toBeUndefined();
		expect(await new ChosenCloud(HOME, fs).read()).toBeNull();
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
		expect(hetzner.requests).toEqual([]);
	});
});
