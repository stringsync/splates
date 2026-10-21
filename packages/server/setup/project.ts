import type { Fs, Ps } from "webappwiz/system";
import { loadConfig } from "../config";
import { Git } from "../git";
import type { SetupProject } from "./setup";

/** The project at `root` as setup reads it: its config and remotes, afresh. */
export function setupProjectAt(
	root: string,
	{ fs, ps }: { fs: Fs; ps: Ps },
): SetupProject {
	const git = new Git(root, { fs, ps });
	return {
		root,
		config: () => loadConfig(root, { fs, git, coordinated: async () => true }),
		remoteUrl: (remote) => git.remoteUrl(remote),
	};
}
