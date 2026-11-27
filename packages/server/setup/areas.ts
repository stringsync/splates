import { AUTOPICK_AREA } from "./area-autopick";
import { DICTATION_AREA } from "./area-dictation";
import {
	ANTIGRAVITY_AREA,
	CLAUDE_AREA,
	CODEX_AREA,
	KIMI_AREA,
} from "./area-native";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { REPLICA_AREA } from "./area-replica";
import { SHIPS_AREA } from "./area-ships";
import type { SetupArea } from "./setup";

/** The areas of setting splates up on a machine, in the order to do them. */
export const SETUP_AREAS: readonly SetupArea[] = [
	CLAUDE_AREA,
	CODEX_AREA,
	KIMI_AREA,
	ANTIGRAVITY_AREA,
	REMOTE_ACCESS_AREA,
	REPLICA_AREA,
	DICTATION_AREA,
	SHIPS_AREA,
	AUTOPICK_AREA,
];
