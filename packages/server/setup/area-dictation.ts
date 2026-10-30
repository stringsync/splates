import {
	OPENAI_KEY,
	PersonalWords,
	parseWords,
	personalWordsPath,
} from "../dictate";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

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
	const wordsStep: SetupStep = {
		id: "dictation-words",
		title: "Teach it your words",
		why: "The mic spells splates, the project's name and the project's `dictationWords` as written; add the names you say in every project, such as your tools and the people you mention.",
		user: "List your words, separated by commas, then press Next. They are kept in `~/.splates/dictation.json`.",
		agent:
			'Have the user list them on the page, or write `~/.splates/dictation.json` as `{ "words": [...] }`. Words for one project go in its `splates.config.ts` as `dictationWords` instead.',
		optional: true,
		after: [dictationStep],
		fields: async (machine) => [
			{
				kind: "text",
				name: "words",
				label: "Your words",
				placeholder: "Pulumi, Fly, Ana",
				value: (
					await store(machine)
						.words()
						.catch(() => [])
				).join(", "),
				optional: true,
			},
		],
		check: (machine) => store(machine).saved(),
		submit: async (machine, answers) => {
			const words = answers.words;
			await store(machine).save(
				parseWords(typeof words === "string" ? words : ""),
			);
		},
		doing: "Saving your words…",
		undo: {
			removes: async (machine) => [
				`Your dictation words in \`${store(machine).path}\``,
			],
			run: (machine) => store(machine).remove(),
		},
	};
	return {
		id: "dictation",
		title: "Dictation",
		purpose: "Speak prompts instead of typing them.",
		steps: [dictationStep, wordsStep],
	};
}

/** The person's words on this machine. */
function store(machine: SetupMachine): PersonalWords {
	return new PersonalWords(personalWordsPath(machine.home), machine);
}
