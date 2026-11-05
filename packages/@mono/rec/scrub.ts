/**
 * The scrubber every log source passes through before a line reaches disk:
 * exact values from `.env` files, common secret shapes, and long random runs.
 */

/** Values shorter than this are left alone: `3000` or `true` in an `.env` would redact ordinary text. */
const MIN_SECRET = 6;

const PATTERNS: { label: string; pattern: RegExp }[] = [
	{ label: "BEARER", pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi },
	{
		label: "JWT",
		pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
	},
	{ label: "SK", pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
	{ label: "AWS", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
];

const HEX_RUN = /\b[0-9a-fA-F]{32,}\b/g;
const BASE64_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

/** Reads the `NAME=value` pairs of an `.env` file, skipping comments and unquoting values. */
export function parseEnv(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const match =
			/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
		if (!match) {
			continue;
		}
		let value = match[2] ?? "";
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
			value = value.slice(1, -1);
		} else {
			value = value.replace(/\s+#.*$/, "");
		}
		out[match[1] as string] = value;
	}
	return out;
}

/** Whether a base64-like run is random: it mixes cases and digits, which words and slugs do not. */
function looksRandom(run: string): boolean {
	return /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run);
}

export class Scrubber {
	private readonly secrets: { name: string; value: string }[];

	constructor(env: Record<string, string> = {}) {
		this.secrets = Object.entries(env)
			.filter(([, value]) => value.length >= MIN_SECRET)
			.map(([name, value]) => ({ name, value }))
			// Longest first, so a value holding another is redacted whole.
			.sort((left, right) => right.value.length - left.value.length);
	}

	/** Merges `.env` files read in order, later ones winning, into one scrubber. */
	static fromEnvFiles(texts: string[]): Scrubber {
		return new Scrubber(Object.assign({}, ...texts.map(parseEnv)));
	}

	scrub(text: string): string {
		let out = text;
		for (const { name, value } of this.secrets) {
			out = out.replaceAll(value, `[REDACTED:${name}]`);
		}
		for (const { label, pattern } of PATTERNS) {
			out = out.replace(pattern, (_match, prefix?: string) =>
				typeof prefix === "string" && prefix
					? `${prefix}[REDACTED:${label}]`
					: `[REDACTED:${label}]`,
			);
		}
		out = out.replace(HEX_RUN, "[REDACTED:HEX]");
		out = out.replace(BASE64_RUN, (run) =>
			run.startsWith("[REDACTED") || !looksRandom(run)
				? run
				: "[REDACTED:RANDOM]",
		);
		return out;
	}
}
