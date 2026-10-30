import { REPLICA_ACCESS_KEY, REPLICA_SECRET_KEY } from "../replica";
import type { SetupArea, SetupStep } from "./setup";

/** Sets up a server on a Droplet: the box you make once by hand and the bucket beside it that its records are copied into. */
export const DROPLET_AREA: SetupArea = dropletArea();

function dropletArea(): SetupArea {
	const keysStep: SetupStep = {
		id: "replica-keys",
		title: "Give the server its replica bucket's keys",
		why: "A server on a Droplet keeps its records in a Spaces bucket beside it, which is what lets it move between machines or come back after its box is lost.",
		user: "Make a Spaces access key limited to the bucket in the DigitalOcean control panel, then paste its key and its secret here.",
		agent: `Follow "Server on a Droplet" in setup.md. Request each with \`splates creds request ${REPLICA_ACCESS_KEY} --device\` and \`splates creds request ${REPLICA_SECRET_KEY} --device\`, with how to make the key, and \`splates creds wait\` for each. On the Droplet, with \`SPLATES_SECRET_STORE=file\` set, they are kept in files only the user may read.`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "cred",
				name: REPLICA_ACCESS_KEY,
				label: "Spaces access key",
				help: "In DigitalOcean's **API** page, under **Spaces Keys**, **Generate New Key**, limited to the bucket; paste its key id.",
			},
			{
				kind: "cred",
				name: REPLICA_SECRET_KEY,
				label: "Spaces secret key",
				help: "The secret shown once beside that key.",
			},
		],
		check: async ({ device }) =>
			(await device.get(REPLICA_ACCESS_KEY)) !== undefined &&
			(await device.get(REPLICA_SECRET_KEY)) !== undefined,
		// The keys go with the area's creds; the Spaces key itself only the person deletes.
		undo: {
			removes: async () => [
				"The Spaces access key and secret kept on this device",
			],
			leaves: async () => [
				"The key still works: delete it under **Spaces Keys** in DigitalOcean's API page, and the bucket and the Droplet from the dashboard, if you no longer want them.",
			],
			run: async () => {},
		},
	};
	return {
		id: "droplet",
		title: "Server on a Droplet",
		purpose:
			"Run splates server on a DigitalOcean Droplet that keeps working while your computer is off.",
		steps: [keysStep],
	};
}
