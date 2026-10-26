import type { Scenario } from "../scenario";
import { scenarios as orchestration } from "./orchestration";
import { scenarios as resources } from "./resources";

/** Every scenario, in the order `list` names them. */
export const SCENARIOS: readonly Scenario[] = [...orchestration, ...resources];
