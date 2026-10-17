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
