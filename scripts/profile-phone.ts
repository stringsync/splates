// @ts-nocheck: playwright-core is not a dependency; the path comes from PLAYWRIGHT_CORE

// biome-ignore-all lint: a throwaway harness that drives the page through window globals

/**
 * Profiles the page on a phone-class CPU while a conversation streams, with
 * no agent and so no tokens: it serves the page from a throwaway `splates
 * server`, swaps the page's conversation `EventSource` for one it drives,
 * and streams a long reply into an open conversation, deltas as the server
 * sends them, beside a few quiet conversations on the list.
 *
 *   PLAYWRIGHT_CORE=/path/to/playwright-core bun scripts/profile-phone.ts [--slowdown 6] [--seconds 20] [--page home|thread]
 *
 * Prints the main thread's busy share, its long tasks and the slowest frames.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { conversation } from "@stringsync/splates-server/fixtures";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const slowdown = Number(flag("slowdown", "6"));
const seconds = Number(flag("seconds", "20"));
const where = flag("page", "thread");
const port = 4790;

const { chromium } = (await import(
	process.env.PLAYWRIGHT_CORE ?? "playwright-core"
)) as typeof import("playwright-core");

const home = mkdtempSync(join(tmpdir(), "profile-phone-"));
const server = Bun.spawn(["bin/splates", "server", "--port", String(port)], {
	env: { ...process.env, SPLATES_HOME: home },
	stdout: "ignore",
	stderr: "ignore",
});
for (let tries = 0; tries < 120; tries++) {
	try {
		if ((await fetch(`http://localhost:${port}/`)).ok) {
			break;
		}
	} catch {}
	await Bun.sleep(500);
}

const repo = mkdtempSync(join(tmpdir(), "profile-repo-"));
for (const argv of [
	["init", "-q", "-b", "main"],
	[
		"-c",
		"user.name=p",
		"-c",
		"user.email=p@p",
		"commit",
		"-q",
		"--allow-empty",
		"-m",
		"init",
	],
]) {
	Bun.spawnSync(["git", ...argv], { cwd: repo });
}
const added = await fetch(`http://localhost:${port}/api/projects`, {
	method: "POST",
	headers: {
		"content-type": "application/json",
		origin: `http://localhost:${port}`,
	},
	body: JSON.stringify({ path: repo }),
});
console.log("project added:", added.status, (await added.text()).slice(0, 200));

const OPEN = "open";
const text = (n: number) =>
	Array.from(
		{ length: n },
		(_, i) =>
			`Paragraph ${i}: **bold**, \`code\` and a [link](https://example.com/${i}) in prose long enough to wrap on a phone.\n\n- one\n- two\n`,
	).join("\n");
const said = (n: number) => ({
	role: "agent" as const,
	parts: [{ type: "text" as const, text: text(n) }],
	plan: null,
	at: new Date().toISOString(),
	until: null,
});
const asked = {
	role: "user" as const,
	parts: [{ type: "text" as const, text: "Go" }],
	plan: null,
	at: new Date().toISOString(),
	until: null,
};
const history = Array.from({ length: 30 }, (_, i) =>
	i % 2 === 0 ? asked : said(3),
);
const open: ConversationState = conversation({
	id: OPEN,
	title: "streaming",
	status: "running",
	messages: [...history, asked, said(1)],
});
const quiet = Array.from({ length: 40 }, (_, i) =>
	conversation({
		id: `q${i}`,
		title: `quiet ${i}`,
		messages: [asked, said(2)],
	}),
);

const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH,
});
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
	deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.addInitScript(() => {
	const Real = window.EventSource;
	const fakes: EventTarget[] = [];
	(window as any).EventSource = class extends EventTarget {
		onmessage: ((e: MessageEvent) => void) | null = null;
		onopen: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(public url: string) {
			super();
			if (!url.includes("/api/conversations/events")) {
				return new Real(url) as never;
			}
			fakes.push(this);
			setTimeout(() => this.onopen?.(), 0);
		}
		close() {}
	};
	(window as any).__say = (name: string | null, data: unknown) => {
		for (const fake of fakes as any[]) {
			const event = new MessageEvent(name ?? "message", {
				data: JSON.stringify(data),
			});
			if (name === null) {
				fake.onmessage?.(event);
			} else {
				fake.dispatchEvent(event);
			}
		}
	};
	(window as any).__busy = { long: [] as number[], frames: [] as number[] };
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			(window as any).__busy.long.push(entry.duration);
		}
	}).observe({ type: "longtask", buffered: true });
	let last = performance.now();
	const tick = (now: number) => {
		(window as any).__busy.frames.push(now - last);
		last = now;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
});

await page.goto(
	`http://localhost:${port}/#${where === "home" ? "" : `conversations/${OPEN}`}`,
);
await page.waitForTimeout(2000);
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
for (const each of [open, ...quiet]) {
	await page.evaluate((s) => (window as any).__say(null, s), each);
}
await page.waitForTimeout(1000);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
await page.evaluate(() => {
	(window as any).__busy.long = [];
	(window as any).__busy.frames = [];
});
// An agent streaming: a delta of the last message's text about every 40ms.
const start = Date.now();
let words = 1;
while (Date.now() - start < seconds * 1000) {
	words++;
	const grown = said(1);
	grown.parts = [
		{ type: "text", text: `${text(1)} ${"streamed word ".repeat(words)}` },
	];
	await page.evaluate((delta) => (window as any).__say("delta", delta), {
		id: OPEN,
		changes: {},
		removed: [],
		messages: {
			length: open.messages.length,
			replace: [[open.messages.length - 1, grown]],
		},
	});
	await Bun.sleep(40);
}
const { profile } = (await cdp.send("Profiler.stop")) as {
	profile: {
		nodes: {
			id: number;
			callFrame: { functionName: string; url: string; lineNumber: number };
		}[];
		samples: number[];
		timeDeltas: number[];
	};
};
await Bun.write("/tmp/profile-phone.cpuprofile", JSON.stringify(profile));
const busy = await page.evaluate(() => (window as any).__busy);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
let idle = 0;
let total = 0;
profile.samples.forEach((id, i) => {
	const dt = profile.timeDeltas[i] ?? 0;
	total += dt;
	const f = byId.get(id)?.callFrame;
	if (f === undefined || ["(idle)", "(program)"].includes(f.functionName)) {
		idle += dt;
		return;
	}
	const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-1)[0]}:${f.lineNumber}`;
	self.set(key, (self.get(key) ?? 0) + dt);
});
const frames = (busy.frames as number[]).sort((a, b) => b - a);
console.log(`slowdown ${slowdown}x, ${seconds}s, page ${where}`);
console.log(`main thread busy ${(100 * (1 - idle / total)).toFixed(1)}%`);
console.log(
	`long tasks: ${busy.long.length}, longest ${Math.max(0, ...busy.long).toFixed(0)}ms`,
);
console.log(
	`slowest frames ms: ${frames
		.slice(0, 5)
		.map((f) => f.toFixed(0))
		.join(", ")}`,
);
console.log("top self time:");
for (const [key, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
	console.log(`  ${(us / 1000).toFixed(0).padStart(6)}ms  ${key}`);
}
console.log(
	"page text:",
	(await page.evaluate(() => document.body.innerText)).length,
	"chars; streamed word in DOM:",
	(await page.evaluate(() => document.body.innerText)).includes(
		"streamed word",
	),
);
await page.screenshot({ path: "/tmp/profile-phone.png" });
await browser.close();
server.kill();
process.exit(0);
