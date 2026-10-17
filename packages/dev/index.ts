import { NodeFs } from "webappwiz/system";
import { dev } from "./dev";

await dev.run({ fs: new NodeFs() });
