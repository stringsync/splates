import type { Fs, Ps } from "webappwiz/system";
import { loadConfig } from "../config";
import { Git } from "../git";
import type { SetupProject } from "./setup";

/**
 * The project at `root` as setup reads it: its config and remotes, afresh,
 * and, from `records`, its replica and creds.
 */
export function setupProjectAt(
	root: string,
	{ fs, ps }: { fs: Fs; ps: Ps },
	records: Pick<SetupProject, "replica" | "kept"> = {},
): SetupProject {
	const git = new Git(root, { fs, ps });
	return {
		...records,
		root,
		config: () => loadConfig(root, { fs, git }),
		remoteUrl: (remote) => git.remoteUrl(remote),
	};
}
