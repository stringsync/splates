import { COORDINATOR_AREA } from "./area-coordinator";
import { DICTATION_AREA } from "./area-dictation";
import { GITHUB_AREA } from "./area-github";
import { GROOMING_AREA } from "./area-grooming";
import { CLAUDE_AREA, CODEX_AREA } from "./area-native";
import { NOTIFICATIONS_AREA } from "./area-notifications";
import { OPENCODE_AREA } from "./area-opencode";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import type { SetupArea } from "./setup";

/**
 * Everything that makes up setting splates up on a machine, in the order it
 * is best done. The page and an agent walk the user through each area one
 * step at a time.
 */
export const SETUP_AREAS: readonly SetupArea[] = [
	OPENCODE_AREA,
	REMOTE_ACCESS_AREA,
	WORKERS_AREA,
	COORDINATOR_AREA,
	NOTIFICATIONS_AREA,
	DICTATION_AREA,
	GITHUB_AREA,
	GROOMING_AREA,
	CLAUDE_AREA,
	CODEX_AREA,
];
