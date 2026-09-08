#!/usr/bin/env bun
import { NodeFs } from "webappwiz/system";
import { arbor } from "./arbor";
import { assets } from "./dev/assets";

await arbor.run({
	fs: new NodeFs(),
	assets,
});
