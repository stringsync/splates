import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { NOTIFICATIONS_AREA } from "./area-notifications";
import { Setup, type SetupArea, type SetupMachine } from "./setup";

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

	/** Two browsers subscribed, each wanting `wants`. */
	const devices = (wants: { waiting: boolean; finished: boolean }) =>
		machine.fs.write(
			`${HOME}/push.json`,
			JSON.stringify({
				keys: { publicKey: "public", privateKey: "private" },
				devices: [
					"https://fcm.googleapis.com/a",
					"https://web.push.apple.com/b",
				].map((endpoint) => ({
					subscription: { endpoint, keys: { p256dh: "BKey", auth: "auth" } },
					wants,
				})),
			}),
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

	it("undoes by forgetting every device, keeping the keys", async () => {
		await devices({ waiting: true, finished: false });
		const setup = new Setup(machine, [NOTIFICATIONS_AREA]);

		expect((await setup.undoPlan("notifications")).steps).toEqual([
			{
				id: "notifications-notices",
				title: "Choose what you are notified of",
				removes: [],
				leaves: [],
			},
			{
				id: "notifications-device",
				title: "Turn notifications on in this browser",
				removes: [
					`The browser pushed through fcm.googleapis.com, kept in \`${HOME}/push.json\``,
					`The browser pushed through web.push.apple.com, kept in \`${HOME}/push.json\``,
				],
				leaves: [
					"Each browser still lets this site notify it: turn that off under Notifications in its site settings.",
				],
			},
		]);
		await setup.undo("notifications", null);
		await NOTIFICATIONS_AREA.steps[0]?.undo?.run(machine);

		expect(await statuses(machine, NOTIFICATIONS_AREA)).toEqual({
			"notifications-device": "ready",
			"notifications-notices": "waiting",
		});
		expect(JSON.parse(await machine.fs.read(`${HOME}/push.json`))).toEqual({
			keys: { publicKey: "public", privateKey: "private" },
			devices: [],
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
