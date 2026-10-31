import type { Registry } from "core/ship";
import type { Pin } from "./graph";

/** The exact upstream versions npm does not serve yet. */
export async function unserved(
	registry: Pick<Registry, "published">,
	pins: Pin[],
): Promise<string[]> {
	const missing: string[] = [];
	for (const pin of pins) {
		if (!(await registry.published(pin.name, pin.version))) {
			missing.push(`${pin.name}@${pin.version}`);
		}
	}
	return missing;
}
