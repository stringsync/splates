import { AUTO_PICK_AREA } from "./area-auto-pick";
import { COORDINATOR_AREA } from "./area-coordinator";
import { DICTATION_AREA } from "./area-dictation";
import { GITHUB_AREA } from "./area-github";
import { CLAUDE_AREA, CODEX_AREA } from "./area-native";
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
	DICTATION_AREA,
	AUTO_PICK_AREA,
	GITHUB_AREA,
	CLAUDE_AREA,
	CODEX_AREA,
];
