#!/usr/bin/env bun
import { NodeFs } from "webappwiz/system";
import { arbor } from "./arbor";
import { assets } from "./dev/assets";
import { BunHttpServer } from "./http-server";

await arbor.run({
	fs: new NodeFs(),
	http: new BunHttpServer(),
	assets,
});
