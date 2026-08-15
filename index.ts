#!/usr/bin/env bun
import { BunHttpServer } from "@webappwiz/http";
import { NodeFs } from "@webappwiz/system";
import { arbor } from "./arbor";
import { BunBundler } from "./bundler/bun-bundler";

await arbor.run({
	fs: new NodeFs(),
	http: new BunHttpServer(),
	bundler: new BunBundler(),
});
