#!/usr/bin/env bun
import { NodeFs } from "core/system";
import { SystemWallClock } from "core/time";
import { rec } from "./rec";

await rec.run({ fs: new NodeFs(), wall: new SystemWallClock() });
