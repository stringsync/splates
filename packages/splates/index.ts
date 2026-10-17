#!/usr/bin/env bun
import { basename } from "node:path";
import { NodeFs } from "webappwiz/system";
import { LEGACY, legacyWarnings } from "./legacy-names";
import { systemPs } from "./legacy-ps";
import { projectArgs, splates } from "./splates";
import { assets } from "./web/assets";

// The bin's old name, kept for one release.
if (basename(process.argv[1] ?? "") === LEGACY) {
	legacyWarnings.once(LEGACY, "splates");
}
const ps = systemPs();
const { project, argv } = projectArgs(ps.args);
await splates.run({ fs: new NodeFs(), ps, assets, project }, argv);
