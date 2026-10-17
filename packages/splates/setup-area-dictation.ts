import { OPENAI_KEY } from "./dev-transcriber";
import type { SetupArea, SetupStep } from "./setup";

/** Speaking a prompt instead of typing it, on an OpenAI key of the user's. */
export const DICTATION_AREA: SetupArea = dictationArea();

function dictationArea(): SetupArea {
	const dictationStep: SetupStep = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The composer's mic transcribes what you say with OpenAI, on a key of your own.",
		user: "Create an OpenAI API key and paste it on the Creds page.",
		agent: `Request it with \`splates creds request ${OPENAI_KEY} --device\`, with how to get it.`,
		optional: true,
		after: [],
		fields: [{ kind: "cred", name: OPENAI_KEY, label: "OpenAI API key" }],
		check: async ({ device }) => (await device.get(OPENAI_KEY)) !== undefined,
	};
	return { id: "dictation", title: "Dictation", steps: [dictationStep] };
}
