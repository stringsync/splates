import type { SetupArea } from "./setup";
import { AGENTS_AREA } from "./setup-area-agents";
import { DICTATION_AREA } from "./setup-area-dictation";
import { CLAUDE_AREA, CODEX_AREA } from "./setup-area-native";
import { NOTIFICATIONS_AREA } from "./setup-area-notifications";
import { OPENCODE_AREA } from "./setup-area-opencode";
import { REMOTE_ACCESS_AREA } from "./setup-area-remote";

/**
 * Everything that makes up setting splates up on a machine, in the order it is
 * best done. Each area is a short list of steps the page and an agent walk
 * the user through one page at a time, and lives in a `setup-area-*.ts` of
 * its own, so redoing one journey touches no other.
 */
export const SETUP_AREAS: readonly SetupArea[] = [
	AGENTS_AREA,
	OPENCODE_AREA,
	REMOTE_ACCESS_AREA,
	NOTIFICATIONS_AREA,
	DICTATION_AREA,
	CLAUDE_AREA,
	CODEX_AREA,
];
