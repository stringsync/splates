import { ClefDecider, type Decider, JevDecider } from "webappwiz/decide";
import { type CleanupModel, DEFAULT_CLEANUP_MODEL } from "./cleanup-models";
import type { Project } from "./dev-project";

export const TYPESAFE_KEY = "TYPESAFE_API_KEY";
export const CLOUDFLARE_ACCOUNT = "CLOUDFLARE_ACCOUNT_ID";
export const CLOUDFLARE_TOKEN = "CLOUDFLARE_AI_TOKEN";

/** What each cred is for, as the Creds page shows it. */
const PURPOSES: Record<string, string> = {
	[TYPESAFE_KEY]:
		"Dictation cleanups decide with TypeSafe's Jev, billed to your key.",
	[CLOUDFLARE_ACCOUNT]:
		"Dictation cleanups decide with Cloudflare's Clef, which runs in your account.",
	[CLOUDFLARE_TOKEN]:
		"Dictation cleanups call Cloudflare's Clef with this token, billed to your account.",
};

/** How to get each cred a cleanup decides with, as the Creds page shows it. */
const INSTRUCTIONS: Record<string, string> = {
	[TYPESAFE_KEY]: `Dictation cleanups decide with TypeSafe's Jev, on your key.

1. Open [TypeSafe](https://typesafe.ai) and sign in.
2. Create an API key.
3. Paste it here.`,
	[CLOUDFLARE_ACCOUNT]: `Dictation cleanups decide with Cloudflare's Clef, which needs your account id.

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com) and pick your account.
2. Copy the **Account ID** from the account's overview page (the menu beside the account name has **Copy account ID**).
3. Paste it here.`,
	[CLOUDFLARE_TOKEN]: `Dictation cleanups decide with Cloudflare's Clef, through Workers AI.

1. Open [API Tokens](https://dash.cloudflare.com/profile/api-tokens), then **Create Token**.
2. Pick the **Workers AI** template (Workers AI · Read and Edit).
3. Create it and paste it here.`,
};

/** The creds `model` decides with. */
export function credsFor(model: CleanupModel): string[] {
	return model.startsWith("jev")
		? [TYPESAFE_KEY]
		: [CLOUDFLARE_ACCOUNT, CLOUDFLARE_TOKEN];
}

/** What a project's cleanups decide with, null once it asked for creds. */
export type DeciderFor = (
	project: Project,
	model: CleanupModel | undefined,
	/** Tells the project's pages that its records moved, as a new request does. */
	tick: () => Promise<void>,
) => Promise<Decider | null>;

/**
 * What `project`'s cleanups decide with on `model` (Clef Flash by default),
 * on the creds the project's or the device's store keeps. Null, after asking
 * for each one missing on the Creds page, when any is.
 */
export const deciderFor: DeciderFor = async (project, model, tick) => {
	const picked = model ?? DEFAULT_CLEANUP_MODEL;
	const values: Record<string, string> = {};
	const missing: string[] = [];
	for (const name of credsFor(picked)) {
		const value = await project.creds.credentials.get(name);
		if (value === undefined) {
			missing.push(name);
		} else {
			values[name] = value;
		}
	}
	if (missing.length > 0) {
		for (const name of missing) {
			await project.journal.record("creds request", null, () =>
				project.creds.request(name, {
					scope: "device",
					purpose: PURPOSES[name] ?? "",
					instructions: INSTRUCTIONS[name] ?? "",
					task: null,
				}),
			);
		}
		await tick();
		return null;
	}
	if (picked === "jev-latest" || picked === "jev-preview") {
		return new JevDecider(values[TYPESAFE_KEY] ?? "", { model: picked });
	}
	return new ClefDecider(
		values[CLOUDFLARE_ACCOUNT] ?? "",
		values[CLOUDFLARE_TOKEN] ?? "",
		{ model: picked },
	);
};
