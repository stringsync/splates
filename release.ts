import { Duration } from "webappwiz/time";
import manifest from "./package.json" with { type: "json" };

/** The version of arbor running now, as `ship` stamped it. */
export const RUNNING: string = manifest.version;

/** Where npm says which version of arbor is the latest. */
export const REGISTRY = "https://registry.npmjs.org/@webappwiz/arbor/latest";

/** How long a check waits on the registry before giving up for this round. */
const PATIENCE = Duration.secs(10);

/** A newer arbor than the one serving, published since it started. */
export interface Release {
	running: string;
	newest: string;
}

/**
 * The latest version of arbor on npm, or null when the registry cannot say:
 * offline, slow, or answering with something else. A check that fails has
 * nothing to tell the person at the page, so it never throws.
 */
export async function newest(registry = REGISTRY): Promise<string | null> {
	try {
		const response = await fetch(registry, {
			signal: AbortSignal.timeout(PATIENCE.ms),
		});
		if (!response.ok) {
			return null;
		}
		const { version } = (await response.json()) as { version?: unknown };
		return typeof version === "string" && parse(version) !== null
			? version
			: null;
	} catch {
		return null;
	}
}

/**
 * Whether `version` is past `than`, by major, minor and patch. A prerelease is
 * never newer: only what `@latest` installs is worth a restart.
 */
export function isNewer(version: string, than: string): boolean {
	const [mine, theirs] = [parse(version), parse(than)];
	if (mine === null || theirs === null) {
		return false;
	}
	for (let i = 0; i < 3; i += 1) {
		if (mine[i] !== theirs[i]) {
			return (mine[i] as number) > (theirs[i] as number);
		}
	}
	return false;
}

function parse(version: string): number[] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match === null ? null : match.slice(1).map(Number);
}
