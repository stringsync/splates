import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import type { Moved } from "../coordinator";
import { coordinatorArea } from "./area-coordinator";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { Setup, type SetupMachine, type SetupStep } from "./setup";

const HOME = "/home/.splates";
const UNIT = "/etc/systemd/system/splates-coordinator.service";

describe("undoing COORDINATOR_AREA", () => {
	let fs: FakeFs;
	let machine: SetupMachine;
	let area: ReturnType<typeof coordinatorArea>;

	beforeEach(async () => {
		fs = new FakeFs();
		machine = {
			fs,
			ps: new FakePs(),
			home: HOME,
			device: new FakeSecretStore(),
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

	it("plans forgetting the dry run, and leaves the stack and its creds alone", async () => {
		await step("coordinator-keys").submit?.(machine, {});

		const plan = await setup().undoPlan("coordinator");

		expect(plan.steps).toEqual([
			{
				id: "coordinator-keys",
				title: "Let the box push each project",
				done: true,
				removes: [],
				leaves: [
					"The deploy keys and creds the Pulumi stack put in the box's Parameter Store.",
				],
			},
			{
				id: "coordinator-remotes",
				title: "Name each project's remote",
				done: true,
				removes: [],
				leaves: [expect.stringContaining('`remote: "origin"`')],
			},
		]);
		expect(plan.refused).toBeNull();
	});

	it("forgets the last dry run once undone", async () => {
		await step("coordinator-keys").submit?.(machine, {});

		await setup().undo("coordinator", "splates");

		expect(await step("coordinator-keys").check(machine)).toBe(false);
	});

	it("refuses every step once the server has moved onto its box", async () => {
		await fs.write(UNIT, "");
		const refusal =
			"splates server runs on its box now, holding the only live records; move it back first (task #385).";

		expect((await setup().undoPlan("coordinator")).refused).toBe(refusal);
		await expect(setup().undo("coordinator", "splates")).rejects.toThrow(
			refusal,
		);
	});
});
