import { Duration } from "webappwiz/time";

/** `text` as a length of time: `30`, `30m` and `30min` are minutes, `90s`, `2h`. Null for anything else. */
export function parseTimeout(text: string): Duration | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(text);
	const scale = SPANS[match?.[2]?.toLowerCase() ?? "?"];
	if (match?.[1] === undefined || scale === undefined) {
		return null;
	}
	const ms = Number(match[1]) * scale;
	return ms > 0 ? Duration.ms(ms) : null;
}

const SPANS: Record<string, number> = {
	"": 60_000,
	s: 1000,
	sec: 1000,
	secs: 1000,
	m: 60_000,
	min: 60_000,
	mins: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hrs: 3_600_000,
};
