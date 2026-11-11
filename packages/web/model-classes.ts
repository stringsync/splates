interface Named {
	value: string;
	name: string;
}

/**
 * Narrows a model list to its newest model of each class (Opus, Sonnet and
 * so on), in the list's order, so a long list reads at a glance. The model in
 * `keep` stays even when it is older.
 */
export function latestPerClass<T extends Named>(
	keep: string,
	options: readonly T[],
): T[] {
	const best = new Map<string, T>();
	for (const option of options) {
		const key = classOf(option);
		const held = best.get(key);
		if (held === undefined || newer(option, held)) {
			best.set(key, option);
		}
	}
	return options.filter(
		(option) => option.value === keep || best.get(classOf(option)) === option,
	);
}

/** A model's class, its name without the version ("Opus 5.5" is "opus"), kept apart by provider. */
function classOf(option: Named): string {
	const provider = option.value.includes("/") ? option.value.split("/")[0] : "";
	const bare = option.name
		.toLowerCase()
		.replace(/\d+(\.\d+)*/g, " ")
		.replace(/[^\p{L}\s]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	return `${provider}|${bare === "" ? option.name : bare}`;
}

/** A model's version as numbers, so "5.10" beats "5.9"; none sorts lowest. */
function versionOf(option: Named): number[] {
	const found = /\d+(\.\d+)*/.exec(option.name);
	return found === null ? [] : found[0].split(".").map(Number);
}

function newer(first: Named, second: Named): boolean {
	const left = versionOf(first);
	const right = versionOf(second);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) {
			return diff > 0;
		}
	}
	return false;
}
