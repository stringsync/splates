// What `bin/splates` runs from a checkout: the published program with `dev`
// mounted, the commands for working on this repository. No `bin` or `exports`
// entry names this file, so a release bundles none of it.
import { mountDev } from "./dev";
import { devMounted } from "./handoff";
import { splates } from "./splates";

mountDev(splates);
devMounted.value = true;
await import("./index");
