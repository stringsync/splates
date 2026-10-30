import { ensure } from "webappwiz/assert";
import { Duration } from "webappwiz/time";
import type { CascadeStep } from "./cascade";
import type { Pin } from "./graph";
import type { ShipRegistry } from "./registry";

/** How often the registry is asked whether a release's packages are on it. */
export const POLL = Duration.secs(10);

/** How often it is asked while the release is still early, before half of the time it is expected to take. */
export const EARLY_POLL = Duration.secs(30);

/** How long to wait before the next check, `waited` ms into a step expected to take `expected` ms: slow while a release is unlikely to be there yet. */
export function pollAfter(waited: number, expected: number): Duration {
	return waited < expected / 2 ? EARLY_POLL : POLL;
}

/** A function giving the wait before the next check, counting from now. */
export function pollSince(
	clock: { now(): number },
	expected: () => number,
): () => Duration {
	const began = clock.now();
	return () => pollAfter(clock.now() - began, expected());
}

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
