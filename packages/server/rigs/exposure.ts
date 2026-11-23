import type { RigProxyRoute, RigProxyTargets } from "../ports";
import type { RunPort, RunSlot } from "./run";
import type { Rig } from "./wire";

/**
 * Exposure helpers for rigs: parsing stdout URL reports (`splates:url ...`),
 * forming stable animal-slot subdomain labels, and projecting run ports and
 * proxy targets from a run's exposure mode.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape codes from log lines
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * Parses a self-exposed rig's stdout line for a reported public URL:
 * - `splates:url <url>` assigns the rig's main (first) port
 * - `splates:url <port> <url>` assigns a named port declared in `ports`
 *
 * Returns null for any other line, an undeclared port, or a non-http(s) URL.
 */
export function parseReportedUrl(
	line: string,
	ports: readonly string[],
): { port: string; url: string } | null {
	const clean = line.replace(ANSI, "").trim();
	const match = /^splates:url\s+(\S+)(?:\s+(\S+))?$/.exec(clean);
	if (match === null) {
		return null;
	}
	const [, first, second] = match;
	const port = second === undefined ? ports[0] : first;
	const raw = second === undefined ? first : second;
	if (port === undefined || raw === undefined || !ports.includes(port)) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.hostname === ""
	) {
		return null;
	}
	return { port, url: raw };
}

/**
 * The subdomain label under `--ports-host` for a tunnel-exposed rig port:
 * `<word>` for the main port, and `<word>-<port>` for any additional port.
 */
export function rigHostLabel(
	word: string,
	port: string,
	main: boolean,
): string {
	return main ? word : `${word}-${port}`;
}

/** Builds each port's local and public links for a run according to its exposure mode. */
export function runPorts(
	rig: Rig,
	ports: Record<string, number>,
	slot: RunSlot | null,
	reportedUrls: Record<string, string>,
	base: string | null,
): RunPort[] {
	return rig.ports.map((name, index) => {
		const port = ports[name] as number;
		let remote: string | null = null;
		if (rig.exposure === "tunnel") {
			remote =
				base === null || slot === null
					? null
					: `https://${rigHostLabel(slot.word, name, index === 0)}.${base}`;
		} else if (rig.exposure === "self") {
			remote = reportedUrls[name] ?? null;
		}
		return {
			name,
			port,
			local: `http://127.0.0.1:${port}`,
			remote,
		};
	});
}

/** Collects live tunnel-exposed animal routes and ports excluded from splates's proxy. */
export function collectRigProxyTargets(
	runs: Iterable<{
		id: string;
		rig: Rig;
		ports: Record<string, number>;
		slot: RunSlot | null;
		live: boolean;
	}>,
): RigProxyTargets {
	const routes: RigProxyRoute[] = [];
	const excluded = new Set<number>();
	for (const each of runs) {
		if (!each.live) {
			continue;
		}
		if (each.rig.exposure === "tunnel") {
			if (each.slot === null) {
				continue;
			}
			for (const [index, name] of each.rig.ports.entries()) {
				const port = each.ports[name];
				if (port !== undefined) {
					routes.push({
						label: rigHostLabel(each.slot.word, name, index === 0),
						port,
						run: each.id,
					});
				}
			}
		} else {
			for (const port of Object.values(each.ports)) {
				excluded.add(port);
			}
		}
	}
	return { routes, excluded };
}
