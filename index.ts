#!/usr/bin/env bun
import { BunHttpServer } from "@webappwiz/http";
import { BunBundler } from "@webappwiz/ship";
import { NodeFs } from "@webappwiz/system";
import { arbor } from "./arbor";

await arbor.run({
	fs: new NodeFs(),
	http: new BunHttpServer(),
	bundler: new BunBundler(),
});
