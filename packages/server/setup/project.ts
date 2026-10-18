import type { Fs, Ps } from "webappwiz/system";
import { Git } from "../git";
import { loadConfig } from "../load-config";
import type { SetupProject } from "./setup";

/** The project at `root` as setup reads it: its config and remotes, afresh. */
export function setupProjectAt(
	root: string,
	{ fs, ps }: { fs: Fs; ps: Ps },
): SetupProject {
	const git = new Git(root, { fs, ps });
	return {
		root,
		config: () => loadConfig(root, { fs, git }),
		remoteUrl: (remote) => git.remoteUrl(remote),
	};
}
