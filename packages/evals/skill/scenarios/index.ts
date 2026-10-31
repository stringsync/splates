import type { Scenario } from "../scenario";
import { scenarios as continuity } from "./continuity";
import { scenarios as decisions } from "./decisions";
import { scenarios as delivery } from "./delivery";
import { scenarios as discovery } from "./discovery";
import { scenarios as lifecycle } from "./lifecycle";
import { scenarios as orchestration } from "./orchestration";
import { scenarios as resources } from "./resources";

/** Every scenario, in the order `list` names them. */
export const SCENARIOS: readonly Scenario[] = [
	...continuity,
	...decisions,
	...delivery,
	...discovery,
	...lifecycle,
	...orchestration,
	...resources,
];
