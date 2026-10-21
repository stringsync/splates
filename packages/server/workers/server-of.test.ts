import { expect, test } from "bun:test";
import { serverOf } from "./server-of";

const ps = (env: Record<string, string>) => ({ env: (n: string) => env[n] });
const log = { info() {}, error() {}, warn() {}, debug() {} };

test("--dev wins over SPLATES_DEV, which wins over nothing", async () => {
	const base = { log, fs: undefined } as never;
	expect(
		(
			await serverOf({
				...base,
				dev: "http://a",
				ps: ps({ SPLATES_DEV: "http://b" }) as never,
			})
		)?.url,
	).toBe("http://a");
	expect(
		(await serverOf({ ...base, ps: ps({ SPLATES_DEV: "http://b" }) as never }))
			?.url,
	).toBe("http://b");
	expect(await serverOf({ ...base, ps: ps({}) as never })).toBeNull();
});
