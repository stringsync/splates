import type { Credentials } from "webappwiz/creds";
import { Clef } from "./clef";
import { Jev } from "./jev";
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
): Promise<Judge | null> {
	const typesafe = await credentials.get("TYPESAFE_API_KEY");
	if (typesafe) {
		return new Jev(typesafe);
	}
	const id = await credentials.get("CLOUDFLARE_ACCOUNT_ID");
	const token = await credentials.get("CLOUDFLARE_API_TOKEN");
	return id && token ? new Clef(id, token) : null;
}
