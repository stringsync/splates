export type {
	Config,
	ConfigFile,
	EvalsConfig,
	ProjectConfig,
	ShipTargetConfig,
	TagsConfig,
} from "./config";
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
export {
	ARTIFACT_LIMITS,
	CONFIG_FILE,
	ConfigFiles,
	loadConfig,
} from "./load";
export type { PathScope, ShipSettings } from "./scopes";
export { Scopes, shipSettings } from "./scopes";
export type { ShipTarget } from "./ships";
export { shipTargets } from "./ships";
export { typedConfig } from "./source";
export { Tags } from "./tags";
