import type { SetupArea } from "./setup";
import { DICTATION_AREA } from "./setup-area-dictation";
import { CLAUDE_AREA, CODEX_AREA } from "./setup-area-native";
import { NOTIFICATIONS_AREA } from "./setup-area-notifications";
import { OPENCODE_AREA } from "./setup-area-opencode";
import { REMOTE_ACCESS_AREA } from "./setup-area-remote";

/**
 * Everything that makes up setting splates up on a machine, in the order it
 * is best done. The page and an agent walk the user through each area one
 * step at a time.
 */
export const SETUP_AREAS: readonly SetupArea[] = [
	OPENCODE_AREA,
	REMOTE_ACCESS_AREA,
	NOTIFICATIONS_AREA,
	DICTATION_AREA,
	CLAUDE_AREA,
	CODEX_AREA,
];
