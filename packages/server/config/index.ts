export type { Config, ConfigFile } from "./config";
export { defineConfig } from "./config";
export {
	LEGACY,
	LEGACY_DIR,
	LEGACY_PLAN_FILE,
	legacyWarnings,
	movedPath,
	moveLegacyDir,
	movePlan,
	removeLegacySkill,
	renamed,
	renameLegacyFiles,
	unmigrated,
} from "./legacy-names";
export { systemPs } from "./legacy-ps";
export { ARTIFACT_LIMITS, CONFIG_FILE, ConfigFiles, loadConfig } from "./load";
export { typedConfig } from "./source";
