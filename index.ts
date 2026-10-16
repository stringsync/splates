#!/usr/bin/env bun
import { NodeFs, NodePs } from "webappwiz/system";
import { arbor, projectArgs } from "./arbor";
import { assets } from "./dev/assets";

const ps = new NodePs();
const { project, argv } = projectArgs(ps.args);
await arbor.run({ fs: new NodeFs(), ps, assets, project }, argv);
