import { OPENAI_KEY } from "../dictate";
import type { SetupArea, SetupStep } from "./setup";

/** Speaking a prompt instead of typing it, on an OpenAI key of the user's. */
export const DICTATION_AREA: SetupArea = dictationArea();

function dictationArea(): SetupArea {
	const dictationStep: SetupStep = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The composer's mic transcribes what you say with OpenAI, on a key of your own.",
		user: "Create an OpenAI API key and paste it here.",
		agent: `Request it with \`splates creds request ${OPENAI_KEY} --device\`, with how to get it.`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "cred",
				name: OPENAI_KEY,
				label: "OpenAI API key",
				help: "Make one at [API keys](https://platform.openai.com/api-keys) with **Create new secret key**, then paste it.",
			},
		],
		check: async ({ device }) => (await device.get(OPENAI_KEY)) !== undefined,
		// The key goes with the area's creds; OpenAI's copy only the person revokes.
		undo: {
			removes: async () => ["The OpenAI API key kept on this device"],
			leaves: async () => [
				"The key still works: revoke it at [API keys](https://platform.openai.com/api-keys) if you no longer want it.",
			],
			run: async () => {},
		},
	};
	return { id: "dictation", title: "Dictation", steps: [dictationStep] };
}
