import type { Entry, Setting } from "../conversations";
import type { Log } from "../storage";

/**
 * Where `model` is among `settings`: the model setting's id, and the value
 * there whose value or name it is; null when none offers it. Provider-qualified
 * values always require an exact ID; `exact` also disables all display aliases.
 */
export function modelOption(
	settings: Setting[],
	model: string,
	exact = false,
): { setting: string; value: string } | null {
	const wanted = model.toLowerCase();
	for (const setting of settings) {
		if (setting.category !== "model" && setting.id !== "model") {
			continue;
		}
		const option = setting.options.find(
			(each) =>
				each.value === model ||
				(!exact &&
					!model.includes("/") &&
					!each.value.includes("/") &&
					(each.value.toLowerCase() === wanted ||
						each.name.toLowerCase() === wanted)),
		);
		if (option !== undefined) {
			return { setting: setting.id, value: option.value };
		}
	}
	return null;
}

/**
 * Where the model `before` offered as `model` is among `settings`, found by
 * its name; null when `before` did not offer it or `settings` has no model
 * of that name. A resumed session can offer a model under another value:
 * Claude's offers its `fable` as `claude-fable-5-1` once resumed on it.
 */
export function renamedModelOption(
	before: Setting[],
	settings: Setting[],
	model: string,
): { setting: string; value: string } | null {
	const was = before
		.filter((each) => each.category === "model" || each.id === "model")
		.flatMap((each) => each.options)
		.find((each) => each.value === model);
	return was === undefined ? null : modelOption(settings, was.name);
}

/**
 * The model `settings` has picked, by its name, `Opus 5.5`; for a default,
 * the model its description says it stands for. Null when none is offered.
 */
export function pickedModel(settings: Setting[]): string | null {
	const setting = settings.find(
		(each) => each.category === "model" || each.id === "model",
	);
	const option = setting?.options.find(
		(each) => each.value === setting.current,
	);
	if (option === undefined) {
		return setting?.current ?? null;
	}
	return option.value === "default" && option.description
		? option.description
		: option.name;
}

/**
 * The agent the conversation logged in `log` runs, and the model it last had
 * picked; null when there is no such log.
 */
export async function ranWith(
	log: Log<Entry>,
): Promise<{ agent: string; model: string | null } | null> {
	const entries = await log.replay();
	const start = entries[0];
	if (start?.kind !== "start") {
		return null;
	}
	const settings = entries.findLast((entry) => entry.kind === "settings");
	return {
		agent: start.agent,
		model: settings === undefined ? null : pickedModel(settings.settings),
	};
}
