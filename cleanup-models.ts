/** The models a dictation's cleanups can decide with, what the Settings dialog offers. */
export const CLEANUP_MODELS = [
	{ value: "clef-flash", label: "Clef Flash (cheapest)" },
	{ value: "clef", label: "Clef" },
	{ value: "jev-latest", label: "Jev (stable)" },
	{ value: "jev-preview", label: "Jev (preview)" },
] as const;

export type CleanupModel = (typeof CLEANUP_MODELS)[number]["value"];

/** The model cleanups use until a person picks another. */
export const DEFAULT_CLEANUP_MODEL: CleanupModel = "clef-flash";

export function isCleanupModel(value: string): value is CleanupModel {
	return CLEANUP_MODELS.some((model) => model.value === value);
}
