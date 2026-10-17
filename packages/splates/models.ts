import type { Fs } from "webappwiz/system";
import type { Setting } from "./conversations";

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
 * The agent the conversation logged at `log` runs, and the model it last had
 * picked; null when there is no such log.
 */
export async function ranWith(
	log: string,
	fs: Fs,
): Promise<{ agent: string; model: string | null } | null> {
	// Only inspect identity/settings entries: conversation logs can be megabytes.
	const lines = (await fs.read(log).catch(() => "")).split("\n");
	const start = parsed(lines[0]);
	if (start?.kind !== "start" || typeof start.agent !== "string") {
		return null;
	}
	// Each line is written with its kind first, so the settings are found
	// without parsing every update the agent sent.
	const settings = parsed(
		lines.findLast((line) => line.startsWith('{"kind":"settings"')),
	)?.settings;
	return {
		agent: start.agent,
		model: Array.isArray(settings) ? pickedModel(settings) : null,
	};
}

/** A log line, as far as `ranWith` needs it; null for one that will not parse. */
function parsed(
	line: string | undefined,
): { kind?: string; agent?: unknown; settings?: Setting[] } | null {
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
}
