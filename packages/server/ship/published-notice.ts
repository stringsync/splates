import { ensure } from "webappwiz/assert";
import { Duration } from "webappwiz/time";
import type { CascadeStep } from "./cascade";
import type { Pin } from "./graph";
import type { ShipRegistry } from "./registry";

/** How often the registry is asked whether a release's packages are on it. */
export const POLL = Duration.secs(5);

/** What the ship command is left to do once its packages are on the registry. */
export function publishedNotice(step: CascadeStep, version: string): string {
	return `${step.publishes.join(", ")} @${version} on the registry; the release is finishing (availability, tag, push)`;
}

/**
 * Waits until every package `step` publishes is on the registry, or `settled`
 * says the ship command is over, and shows the notice on the page when it is. The command prints nothing in that time, so this is what shows it moved on.
 */
export async function untilPublished(
	registry: Pick<ShipRegistry, "published">,
	step: CascadeStep,
	version: string,
	wait: {
		settled: () => boolean;
		pause: () => Promise<void>;
		show: (notice: string) => Promise<void>;
	},
): Promise<void> {
	while (!wait.settled()) {
		const found = await Promise.all(
			step.publishes.map((name) =>
				registry.published(name, version).catch(() => false),
			),
		);
		if (found.every(Boolean)) {
			await wait.show(publishedNotice(step, version));
			return;
		}
		await wait.pause().catch(() => {});
	}
}

/** Whether every package `step` publishes is on the registry at `version`. */
export async function allPublished(
	registry: Pick<ShipRegistry, "published">,
	step: CascadeStep,
	version: string,
): Promise<boolean> {
	const found = [];
	for (const name of step.publishes) {
		found.push(await registry.published(name, version));
	}
	return found.every(Boolean);
}

/** The packages `step` published, at the version it went to. */
export function pinsOf(step: CascadeStep): Pin[] {
	return step.publishes.map((name) => ({
		name,
		version: ensure.present(step.to),
	}));
}
