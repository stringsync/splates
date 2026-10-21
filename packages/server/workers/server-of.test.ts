import { expect, test } from "bun:test";
import type { Ps } from "webappwiz/system";
import { serverOf } from "./server-of";

const ps = (env: Record<string, string>) =>
	({ env: (key: string) => env[key] }) as unknown as Ps;
const log = { info() {}, error() {}, warn() {}, debug() {} };

test("--dev wins over SPLATES_DEV, which wins over nothing", async () => {
	const base = { log, fs: undefined };
	expect(
		(
			await serverOf({
				...base,
				dev: "http://a",
				ps: ps({ SPLATES_DEV: "http://b" }),
			})
		)?.url,
	).toBe("http://a");
	expect(
		(await serverOf({ ...base, ps: ps({ SPLATES_DEV: "http://b" }) }))?.url,
	).toBe("http://b");
	expect(await serverOf({ ...base, ps: ps({}) })).toBeNull();
});
