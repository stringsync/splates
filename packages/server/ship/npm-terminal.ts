// biome-ignore lint/suspicious/noControlCharactersInRegex: color escapes
export const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
// npm's sign-in page, and the page a publish's second factor is answered on.
export const NPM_PAGE = /https:\/\/(?:www\.)?npmjs\.com\/(?:login|auth)\S*/;
// What npm prints around its link, which does not mean the person answered.
export const AROUND_LINK =
	/^(?:press enter|authenticate your account|login at|log in at)/i;
// webappwiz's release asking before it publishes.
export const RELEASE_PROMPT = /\(y\/n\)\s*$/;
// npm's prompt for a typed one-time password, which ends without a newline.
export const OTP_PROMPT = /one-time password.*:\s*$|enter otp:\s*$/i;

// npm prints its pages' links rather than waiting for Enter to open them in a
// browser on the server's machine, which the person may be nowhere near.
export const NPM_ENV = { npm_config_browser: "false" };

// The argv that runs a ship's `command` through `sh` with echo off, so nothing
// typed at its terminal lands in the log.
export function quietly(command: string): string[] {
	// Started on a terminal, npm asks for a publish's second factor rather than
	// failing with EOTP.
	return ["sh", "-c", `stty -echo 2>/dev/null; ${command}`];
}

// A terminal wide enough that npm's links are not wrapped.
export const TERMINAL = { cols: 200, rows: 50 };

// Why a ship stopped at npm's typed-code prompt, with the remedy: npm asks
// on its own page instead once the account's second factor is a security
// key. One line, since a cascade shows an error's first.
export function typedCodeError(user: string | null): string {
	const settings =
		user === null
			? "https://www.npmjs.com/settings"
			: `https://www.npmjs.com/settings/${user}/tfa`;
	return `npm asked for a typed code, which splates never takes: add a security key to your npm 2FA at ${settings} so npm asks on its page`;
}
