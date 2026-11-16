import type { Terminal } from "@xterm/xterm";

const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PAGE_MONO = "JetBrains Mono Variable";

/** The font to create a terminal with, before `switchToPageFont`. */
export const TERMINAL_FONT = SYSTEM_MONO;

/**
 * Moves `terminal` onto the page's mono font once that font has loaded. Call
 * it after opening the terminal, and fit the terminal to its box again when
 * the result settles, since the cells change size.
 */
export async function switchToPageFont(terminal: Terminal): Promise<void> {
	// A terminal sizes its cells from the font it measured, so it starts on the
	// system's and switches only once the page's is ready: a new family is what
	// makes it measure again.
	const fonts = globalThis.document?.fonts;
	if (!fonts) {
		return;
	}
	const loaded = await fonts.load(`13px "${PAGE_MONO}"`).catch(() => []);
	if (loaded.length > 0) {
		terminal.options.fontFamily = `"${PAGE_MONO}", ${SYSTEM_MONO}`;
	}
}
