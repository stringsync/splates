import { beforeEach, describe, expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import type { Cdp, CdpEvent } from "./cdp";
import { BrowserLogs } from "./logs";
import { Scrubber } from "./scrub";

const START = Date.parse("2026-11-03T12:00:00.000Z");

describe("browser logs", () => {
	let fs: FakeFs;
	let emit: (event: CdpEvent) => void;
	let logs: BrowserLogs;

	beforeEach(async () => {
		fs = new FakeFs();
		emit = () => {};
		const cdp = {
			send: async (method: string) =>
				method === "Target.getTargets"
					? { targetInfos: [{ targetId: "t", type: "page", url: "http://a/" }] }
					: method === "Target.attachToTarget"
						? { sessionId: "s" }
						: {},
			on: (listener: (event: CdpEvent) => void) => {
				emit = listener;
				return { dispose() {} };
			},
			closed: new Promise<void>(() => {}),
			dispose() {},
		} as unknown as Cdp;
		logs = await BrowserLogs.start({
			cdp,
			fs,
			dir: "/s",
			scrubber: new Scrubber({ DB_PASS: "hunter2hunter2" }),
			skip: { skips: () => false },
		});
	});

	test("lines are scrubbed on their way to the files", async () => {
		emit({
			method: "Runtime.consoleAPICalled",
			sessionId: "s",
			params: {
				type: "log",
				timestamp: START,
				args: [{ type: "string", value: "pw hunter2hunter2" }],
			},
		});
		await logs.flush();
		expect(await fs.read("/s/logs/console.log")).toBe(
			"2026-11-03T12:00:00.000Z INFO  pw [REDACTED:DB_PASS]\n",
		);
	});
});
