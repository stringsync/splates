import { messageOf } from "../conversations";

/** Redacts common credential-bearing diagnostics before persistence or display. */
export function agentError(message: string): string {
	return (
		message
			// biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal escape sequences from diagnostics.
			.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
			.replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
			.replace(
				/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
				"$1[redacted]",
			)
			.replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
			.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
	);
}

/** ACP's code for a request refused until the agent is signed in. */
const AUTH_REQUIRED = -32000;

/** How the person signs in to an agent that refuses until they do, by its id. */
const SIGN_IN: Record<string, string> = { kimi: "kimi login" };

/**
 * What an agent's failed request says, redacted: its message, and the detail
 * an ACP error carries in `data`, without which most say only "Internal error".
 * An agent `agent` names that refuses for want of a sign-in says how to sign in.
 */
export function requestError(error: unknown, agent?: string): string {
	const message = messageOf(error);
	const data =
		typeof error === "object" && error !== null && "data" in error
			? error.data
			: undefined;
	const detail =
		data == null
			? null
			: typeof data === "string"
				? data
				: typeof data === "object" &&
						"details" in data &&
						typeof data.details === "string"
					? data.details
					: JSON.stringify(data);
	const said =
		detail === null || message.includes(detail)
			? message
			: `${message}: ${detail}`;
	const code =
		typeof error === "object" && error !== null && "code" in error
			? error.code
			: undefined;
	const signIn = agent === undefined ? undefined : SIGN_IN[agent];
	return agentError(
		code === AUTH_REQUIRED && signIn !== undefined
			? `${said}. Run \`${signIn}\` in a terminal to sign in, then try again.`
			: said,
	);
}
