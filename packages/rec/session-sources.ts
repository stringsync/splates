import type { Source } from "./session";

/** The sources a session's manifest lists: what recorded it, from the mic's label and the log options. */
export function manifestSources(
	mic: string | undefined,
	sources: { docker?: string; tails: string[] },
): Source[] {
	return [
		{
			kind: "screencast",
			detail: "the active tab, from Chrome's DevTools screencast",
		},
		...(mic === undefined ? [] : [{ kind: "mic" as const, detail: mic }]),
		{
			kind: "console",
			detail: "Chrome's console messages and exceptions, scrubbed",
		},
		{
			kind: "network",
			detail:
				"one summary line per request, without headers or bodies, scrubbed",
		},
		{
			kind: "pointer",
			detail:
				"the pointer script in the working window: elements under the pointer, clicks, routes, typing (never the text) and Option-held highlights, with stills in frames/",
		},
		...(sources.docker === undefined
			? []
			: [
					{
						kind: "docker" as const,
						detail: `docker logs -f for ${sources.docker === "true" ? "the Compose project or every running container" : sources.docker}, scrubbed`,
					},
				]),
		...sources.tails.map((tail) => ({
			kind: "tail" as const,
			detail: `${tail}, followed, scrubbed`,
		})),
	];
}
