import type { Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import type { SecretStores } from "../creds";
import type { Assets } from "./assets";

/** Everything `splates` is run with, before the repository middleware adds to it. */
export interface SplatesDeps extends Deps {
	fs: Fs;
	/**
	 * The registered project a leading `--project <slug>` names, which repo
	 * commands run on instead of the one the working directory is in.
	 */
	project?: string;
	/** The built page `dev` serves as its preview. */
	assets: Assets;
	/** Where creds are kept; the system's stores by default. */
	secrets?: SecretStores;
	/** How `splates tunnel setup` reaches Cloudflare's API; the global one by default. */
	fetch?: typeof fetch;
}
