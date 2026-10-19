import type { Fs, Ps } from "webappwiz/system";
import { loadConfig } from "../config";
import { Git } from "../git";
import { GROOMER_AUTOMATION, HookStore } from "../hooks";
import type { SetupProject } from "./setup";

/**
 * The project at `root` as setup reads it: its config and remotes, afresh,
 * and its groomer, `groomed` told once Setup turns it on or off.
 */
export function setupProjectAt(
	root: string,
	{ fs, ps }: { fs: Fs; ps: Ps },
	groomed: () => void = () => {},
): SetupProject {
	const git = new Git(root, { fs, ps });
	const hooks = new HookStore(`${root}/.git/splates/hooks.json`, fs);
	return {
		root,
		config: () => loadConfig(root, { fs, git }),
		remoteUrl: (remote) => git.remoteUrl(remote),
		groomer: async () => {
			const found = (await hooks.read()).find(
				({ id }) => id === GROOMER_AUTOMATION,
			);
			if (found?.hook.kind !== "groom") {
				return null;
			}
			const { kind: _, ...pick } = found.hook;
			return pick;
		},
		setGroomer: async (pick) => {
			await hooks.groomer(pick);
			groomed();
		},
	};
}
