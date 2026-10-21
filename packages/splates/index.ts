#!/usr/bin/env bun
import { basename } from "node:path";
import {
	LEGACY,
	legacyWarnings,
	systemPs,
} from "@stringsync/splates-server/config";
import { assets } from "@stringsync/splates-server/server";
import { NodeFs } from "webappwiz/system";
import { projectArgs, splates } from "./splates";

// The bin's old name, kept for one release.
if (basename(process.argv[1] ?? "") === LEGACY) {
	legacyWarnings.once(LEGACY, "splates");
}
const ps = systemPs();
const { project, argv } = projectArgs(ps.args);
await splates.run({ fs: new NodeFs(), ps, assets, project }, argv);
