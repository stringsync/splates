import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { Setup, type SetupArea, type SetupMachine } from "./setup";
import { NOTIFICATIONS_AREA } from "./setup-area-notifications";

const HOME = "/home/.splates";

/** Each step's status, by id. */
async function statuses(machine: SetupMachine, area: SetupArea) {
	const progress = await new Setup(machine, [area]).read();
	return Object.fromEntries(
		(progress.areas[0]?.steps ?? []).map((step) => [step.id, step.status]),
	);
}

describe("NOTIFICATIONS_AREA", () => {
	let machine: SetupMachine;

	beforeEach(async () => {
		machine = { fs: new FakeFs(), home: HOME, device: new FakeSecretStore() };
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	const devices = (wants: { waiting: boolean; finished: boolean }) =>
		machine.fs.write(
			`${HOME}/push.json`,
			JSON.stringify({ keys: {}, devices: [{ wants }] }),
		);

	it("is done once a device wants a notice", async () => {
		await devices({ waiting: true, finished: false });

		expect(await statuses(machine, NOTIFICATIONS_AREA)).toEqual({
			"notifications-device": "done",
			"notifications-notices": "done",
		});
	});

	it("leaves the notices to do while the device wants none", async () => {
		await devices({ waiting: false, finished: false });

		expect(await statuses(machine, NOTIFICATIONS_AREA)).toEqual({
			"notifications-device": "done",
			"notifications-notices": "ready",
		});
	});

	it("asks for at least one notice when Next is pressed", async () => {
		await devices({ waiting: true, finished: false });
		const setup = new Setup(machine, [NOTIFICATIONS_AREA]);

		await expect(
			setup.submit("notifications-notices", {
				waiting: false,
				finished: false,
			}),
		).rejects.toThrow("Turn on at least one notice");
		await setup.submit("notifications-notices", {
			waiting: true,
			finished: false,
		});
	});
});
