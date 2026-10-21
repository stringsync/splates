import type { Credentials } from "webappwiz/creds";
import { splatesHome } from "../models";
import type { Project } from "../server/shared";
import { Spend } from "../spend";
import { FsStorage } from "../storage";
import { Clef } from "./clef";
import { type Attribution, Jev, type JevOptions } from "./jev";
import type { Judge } from "./system-one";

/** The creds each judge reads, named as `wiz creds` names them. */
export const JUDGE_CREDS = {
	jev: ["TYPESAFE_API_KEY"],
	clef: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
} as const;

/**
 * The judge `classify` asks: Jev when its key is kept, else Clef when its
 * account is; null when neither is.
 */
export async function judgeFrom(
	credentials: Pick<Credentials, "get">,
	opts: JevOptions = {},
): Promise<Judge | null> {
	const typesafe = await credentials.get("TYPESAFE_API_KEY");
	if (typesafe) {
		return new Jev(typesafe, opts);
	}
	const id = await credentials.get("CLOUDFLARE_ACCOUNT_ID");
	const token = await credentials.get("CLOUDFLARE_API_TOKEN");
	return id && token ? new Clef(id, token) : null;
}

/** The judge for work done for `who`, as a caller asks it. */
export type JudgeFor = (who: Partial<Attribution>) => Promise<Judge | null>;

/**
 * The judge `project`'s creds give, Jev's calls recorded in the machine's
 * ledger under the project's `slug`, when it has one, and `who`.
 */
export async function projectJudge(
	project: Project,
	slug: () => Promise<string | null>,
	who: Partial<Attribution> = {},
): Promise<Judge | null> {
	return judgeFrom(project.creds.credentials, {
		spend: new Spend(new FsStorage(splatesHome(project.ps), project.fs)),
		attribution: {
			project: await slug(),
			task: who.task ?? null,
			conversation: who.conversation ?? null,
		},
	});
}
