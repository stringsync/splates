#!/usr/bin/env bun
import { BunHttpServer } from "@webappwiz/http";
import { NodeFs } from "@webappwiz/sys";
import { arbor } from "./arbor";
import { BunBundler } from "./page/bundler/bun-bundler";

export type { ArborDeps } from "./arbor";
export type { Git } from "./git";
export type { Journal } from "./journal";
export type { Shell } from "./shell";
export type { WorktreeService } from "./worktree-service";

await arbor.run({
	fs: new NodeFs(),
	http: new BunHttpServer(),
	bundler: new BunBundler(),
});
