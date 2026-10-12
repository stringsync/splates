import type { Setting } from "./conversations";

/**
 * Where `model` is among `settings`: the model setting's id, and the value
 * there whose value or name it is, in any case; null when none offers it.
 */
export function modelOption(
	settings: Setting[],
	model: string,
): { setting: string; value: string } | null {
	const wanted = model.toLowerCase();
	for (const setting of settings) {
		if (setting.category !== "model" && setting.id !== "model") {
			continue;
		}
		const option = setting.options.find(
			(each) =>
				each.value.toLowerCase() === wanted ||
				each.name.toLowerCase() === wanted,
		);
		if (option !== undefined) {
			return { setting: setting.id, value: option.value };
		}
	}
	return null;
}
