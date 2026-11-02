import { AUTO_PICK_AREA } from "./area-auto-pick";
import { DICTATION_AREA } from "./area-dictation";
import { EVALS_AREA } from "./area-evals";
import { CLAUDE_AREA, CODEX_AREA, KIMI_AREA } from "./area-native";
import { OPENCODE_AREA } from "./area-opencode";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { REPLICA_AREA } from "./area-replica";
import { SHIPS_AREA } from "./area-ships";
import type { SetupArea } from "./setup";

/**
 * Everything that makes up setting splates up on a machine, in the order it
 * is best done. The page and an agent walk the user through each area one
 * step at a time.
 */
export const SETUP_AREAS: readonly SetupArea[] = [
	CLAUDE_AREA,
	CODEX_AREA,
	KIMI_AREA,
	OPENCODE_AREA,
	REMOTE_ACCESS_AREA,
	REPLICA_AREA,
	DICTATION_AREA,
	EVALS_AREA,
	SHIPS_AREA,
	AUTO_PICK_AREA,
];
