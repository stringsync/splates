import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Set by `checkout.ts` once `splates dev` is mounted on this process. */
export const devMounted = { value: false };

const CHECKOUT_BIN = join("bin", "splates");
const CHECKOUT_ENTRY = join("packages", "splates", "checkout.ts");

/** The nearest directory at or above `cwd` that is a splates checkout. */
export function checkoutAbove(cwd: string): string | null {
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		if (
			existsSync(join(dir, CHECKOUT_BIN)) &&
			existsSync(join(dir, CHECKOUT_ENTRY))
		) {
			return dir;
		}
		if (dirname(dir) === dir) {
			return null;
		}
	}
}

/**
 * The release has no `splates dev`, and would print help and exit 0, which
 * reads as a passing `splates dev test`. Standing in a checkout, run the
 * checkout's own `bin/splates` instead; anywhere else, fail saying so.
 * Returns the exit code, or null when `argv` is no `dev` command.
 */
export async function handOffDev(
	argv: string[],
	cwd: string,
): Promise<number | null> {
	if (devMounted.value || argv[0] !== "dev") {
		return null;
	}
	const checkout = checkoutAbove(cwd);
	if (checkout === null) {
		console.error(
			"splates dev is only in a splates checkout, and this directory is in none: cd into one and run its bin/splates.",
		);
		return 1;
	}
	const proc = Bun.spawn([join(checkout, CHECKOUT_BIN), ...argv], {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await proc.exited;
}
