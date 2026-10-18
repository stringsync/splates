/**
 * Scores the real judge on the labelled prompts: `bun evals/auto-pick/eval.ts`.
 * Paid: each case is a judgment billed to the kept Jev or Clef cred, so run it
 * only when asked.
 */

import { judgeFrom } from "@stringsync/splates-server/models";
import { Credentials, SystemSecretStore } from "webappwiz/creds";
import { score } from "./cases";

const judge = await judgeFrom(new Credentials([SystemSecretStore.device()]));
if (judge === null) {
	console.error(
		"no judge cred kept for this device: `splates creds request TYPESAFE_API_KEY --device` first",
	);
	process.exit(1);
}
const result = await score(judge);
console.log(
	`exact ${result.exact}/${result.total}, within a tier ${result.near}/${result.total}`,
);
for (const miss of result.misses) {
	console.log(`  wanted ${miss.tier}, got ${miss.got}: ${miss.prompt}`);
}
