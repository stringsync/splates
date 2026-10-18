import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { SetupArea, SetupStep } from "./setup";

/** Pushes to this browser when an agent waits or finishes. */
export const NOTIFICATIONS_AREA: SetupArea = notificationsArea();

function notificationsArea(): SetupArea {
	const deviceStep: SetupStep = {
		id: "notifications-device",
		title: "Turn notifications on in this browser",
		why: "A push reaches a device only after its browser has asked for them from the page.",
		user: "Press Next and allow notifications when this browser asks. Do it on each device you want them on.",
		agent:
			'Have the user open Setup in the page on the device and press Next, which asks the browser for permission; or turn "Notify me" on in the page\'s settings.',
		notDone:
			"This browser has not been subscribed: allow notifications when it asks, then press Next.",
		optional: true,
		after: [],
		check: async ({ fs, home }) => (await pushDevices(fs, home)).length > 0,
	};

	const noticesStep: SetupStep = {
		id: "notifications-notices",
		title: "Choose what you are notified of",
		why: "A device is pushed only the notices it wants, so one that wants none stays silent.",
		user: "Pick whether an agent waiting or finishing should reach you.",
		fields: [
			{ kind: "yes-no", name: "waiting", label: "When an agent needs you" },
			{
				kind: "yes-no",
				name: "finished",
				label: "When an agent finishes its turn",
			},
		],
		// The page saves them for this browser and tells the server before this runs.
		submit: async (_machine, answers) => {
			if (answers.waiting !== true && answers.finished !== true) {
				throw new Error("Turn on at least one notice, or go back.");
			}
		},
		notDone:
			"The server has not heard what this browser wants: allow notifications first, then press Next.",
		agent:
			"Ask the user which notices they want, then have them set it in the page's notification settings.",
		optional: true,
		after: [deviceStep],
		check: async ({ fs, home }) =>
			(await pushDevices(fs, home)).some(
				(device) => device.wants.waiting || device.wants.finished,
			),
	};

	return {
		id: "notifications",
		title: "Notifications",
		steps: [deviceStep, noticesStep],
	};
}

/** What `push.json` keeps of each device, as far as a check needs it. */
const PUSH_DEVICES = z.object({
	devices: z.array(
		z.object({
			wants: z.object({ waiting: z.boolean(), finished: z.boolean() }),
		}),
	),
});

/** The devices `push.json` keeps, none when it is not there. */
async function pushDevices(fs: Fs, home: string) {
	const raw = await fs.read(`${home}/push.json`).catch(() => null);
	return raw === null ? [] : PUSH_DEVICES.parse(JSON.parse(raw)).devices;
}
