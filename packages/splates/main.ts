import { basename } from "node:path";
import { assets } from "@stringsync/splates-server/assets";
import {
	LEGACY,
	legacyWarnings,
} from "@stringsync/splates-server/legacy-names";
import { systemPs } from "@stringsync/splates-server/legacy-ps";
import { NodeFs } from "webappwiz/system";
import { projectArgs, splates } from "./splates";

/**
 * Runs the splates program on the process's own arguments. Both entries end
 * here: `index.ts`, the published bin, and `checkout.ts`, which mounts `dev`
 * first.
 */
export async function main(): Promise<void> {
	// The bin's old name, kept for one release.
	if (basename(process.argv[1] ?? "") === LEGACY) {
		legacyWarnings.once(LEGACY, "splates");
	}
	const ps = systemPs();
	const { project, argv } = projectArgs(ps.args);
	await splates.run({ fs: new NodeFs(), ps, assets, project }, argv);
}
