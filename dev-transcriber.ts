import { basename } from "node:path";
import type { Transcriber } from "webappwiz/dictate";
import { OpenAiTranscriber } from "webappwiz/dictate/server";
import type { Project } from "./dev-project";
import { readSystems } from "./systems";
import { vocabulary, words } from "./vocabulary";

/** The cred a dictation transcribes with. */
export const OPENAI_KEY = "OPENAI_API_KEY";

/** What {@link OPENAI_KEY} is for, as the Creds page shows it. */
const PURPOSE =
	"The mic in the composer transcribes what you say with OpenAI's `gpt-live-transcribe`, on your key.";

/** How to get {@link OPENAI_KEY}, as the Creds page shows it. */
const INSTRUCTIONS = `1. Open [API keys](https://platform.openai.com/api-keys), then **Create new secret key**.
2. Give it access to the Realtime API (or all), and create it.
3. Paste it here.`;

/** What a dictation in a project transcribes with, null once it asked for a key. */
export type TranscriberFor = (
	project: Project,
	/** Tells the project's pages that its records moved, as a new request does. */
	tick: () => Promise<void>,
) => Promise<Transcriber | null>;

/**
 * What a dictation in `project` transcribes with: OpenAI on the key the
 * project's or the device's store keeps, told the project's own words so it
 * spells them its way, read afresh for each take. Null, after asking for the
 * key on the Creds page, when neither store keeps one.
 */
export const transcriberFor: TranscriberFor = async (project, tick) => {
	const key = await project.creds.credentials.get(OPENAI_KEY);
	if (key === undefined) {
		await project.journal.record("creds request", null, () =>
			project.creds.request(OPENAI_KEY, {
				scope: "device",
				purpose: PURPOSE,
				instructions: INSTRUCTIONS,
				task: null,
			}),
		);
		await tick();
		return null;
	}
	const root = project.service.git.root;
	const systems = await readSystems(root, project.fs);
	const name = basename(root);
	return new OpenAiTranscriber(key, {
		prompt: vocabulary(name, systems),
		keywords: words(name, systems),
	});
};
