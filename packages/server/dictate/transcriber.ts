import { basename } from "node:path";
import type { Transcriber } from "webappwiz/dictate";
import { OpenAiTranscriber } from "webappwiz/dictate/server";
import { splatesHome } from "../models";
import type { Project } from "../server/shared";
import { PersonalWords, personalWordsPath } from "./personal";
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
	tick: () => void,
) => Promise<Transcriber | null>;

/**
 * What a dictation in `project` transcribes with: OpenAI on the key the
 * project's or the device's store keeps, told splates's, the project's and
 * the person's words (`dictationWords`, `~/.splates/dictation.json`) so it
 * spells them its way, read afresh for each take. Null, after asking for the
 * key on the Creds page, when neither store keeps one.
 */
export const transcriberFor: TranscriberFor = async (project, tick) => {
	const key = await project.creds.credentials.get(OPENAI_KEY);
	if (key === undefined) {
		await project.journal.record(
			"creds request",
			null,
			() =>
				project.creds.request(OPENAI_KEY, {
					scope: "device",
					purpose: PURPOSE,
					instructions: INSTRUCTIONS,
					task: null,
				}),
			(asked) => ({ name: OPENAI_KEY, asked: asked !== null }),
		);
		tick();
		return null;
	}
	const root = project.service.git.root;
	const personal = await new PersonalWords(
		personalWordsPath(splatesHome(project.ps)),
		project,
	)
		.words()
		.catch((error: unknown) => {
			// A broken list costs the take its spellings, not the take.
			project.log.error(error instanceof Error ? error.message : String(error));
			return [];
		});
	const listed = words(basename(root), project.config.dictationWords, personal);
	return new OpenAiTranscriber(key, {
		prompt: vocabulary(listed),
		keywords: listed,
	});
};
