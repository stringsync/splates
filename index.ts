#!/usr/bin/env bun
import { ConsoleLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/sys";
import { arbor } from "./arbor";

export type { ArborDeps } from "./arbor";
export type { Git } from "./git";
export type { Journal } from "./journal";
export type { Shell } from "./shell";
export type { WorktreeStore } from "./worktree-store";

const ps = new NodePs();

await arbor.run({ log: new ConsoleLogger(), fs: new NodeFs(), ps }, ps.args);
