import type { Resource } from "core/disposable";
import type { Fs } from "core/system";
import {
	Duration,
	SystemWallClock,
	type Timer,
	timeouts,
	type WallClock,
} from "core/time";
import type { Cdp } from "./cdp";
import { redactUrl } from "./network";
import type { Scrubber } from "./scrub";

export const SNAPSHOTS_DIR = "snapshots";
export const SNAPSHOT_STYLES = [
	"display",
	"visibility",
	"position",
	"z-index",
	"overflow",
	"color",
	"background-color",
	"font-family",
	"font-size",
	"font-weight",
	"line-height",
	"opacity",
	"pointer-events",
	"transform",
];
const MAX_BYTES = 50_000_000;
const MAX_CAPTURE_BYTES = 5_000_000;

interface Rare<T> {
	index: number[];
	value: T[];
}
interface SnapshotDocument {
	documentURL: number;
	nodes: {
		parentIndex: number[];
		nodeType: number[];
		nodeName: number[];
		nodeValue: number[];
		attributes: number[][];
		contentDocumentIndex?: Rare<number>;
	};
	layout: { nodeIndex: number[]; bounds: number[][]; styles: number[][] };
	scrollOffsetX?: number;
	scrollOffsetY?: number;
}
export interface ChromeSnapshot {
	strings: string[];
	documents: SnapshotDocument[];
}

/** Inspectable page structure with field values and embedded scripts excluded. */
export function cleanSnapshot(raw: ChromeSnapshot, scrubber: Scrubber) {
	const text = (index: number) => scrubber.scrub(raw.strings[index] ?? "");
	return raw.documents.map((doc) => {
		const hidden = new Set<number>();
		const layout = new Map(doc.layout.nodeIndex.map((node, i) => [node, i]));
		const children = new Map(
			(doc.nodes.contentDocumentIndex?.index ?? []).map((node, i) => [
				node,
				doc.nodes.contentDocumentIndex?.value[i],
			]),
		);
		return {
			url: scrubber.scrub(redactUrl(raw.strings[doc.documentURL] ?? "")),
			scroll: [doc.scrollOffsetX ?? 0, doc.scrollOffsetY ?? 0],
			nodes: doc.nodes.nodeName.map((name, i) => {
				const tag = text(name);
				const parent = doc.nodes.parentIndex[i] ?? -1;
				const attrs = doc.nodes.attributes[i] ?? [];
				const attributes: Record<string, string> = {};
				let editable = false;
				for (let j = 0; j < attrs.length; j += 2) {
					const key = (raw.strings[attrs[j] ?? -1] ?? "").toLowerCase();
					const value = raw.strings[attrs[j + 1] ?? -1] ?? "";
					if (key === "contenteditable" && value !== "false") {
						editable = true;
					}
					// Retain structural identifiers and accessibility labels, not arbitrary embedded app state.
					if (
						[
							"id",
							"class",
							"role",
							"type",
							"name",
							"disabled",
							"hidden",
							"contenteditable",
							"title",
						].includes(key) ||
						(key.startsWith("aria-") && !key.startsWith("aria-value"))
					) {
						attributes[key] = scrubber.scrub(value);
					}
					if (
						["href", "src", "action"].includes(key) &&
						!/^(data|javascript):/i.test(value)
					) {
						attributes[key] = scrubber.scrub(redactUrl(value));
					}
				}
				if (
					hidden.has(parent) ||
					editable ||
					["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT"].includes(
						tag.toUpperCase(),
					)
				) {
					hidden.add(i);
				}
				const row = layout.get(i);
				return {
					parent,
					name: tag,
					type: doc.nodes.nodeType[i],
					attributes,
					text:
						hidden.has(i) || doc.nodes.nodeType[i] !== 3
							? ""
							: text(doc.nodes.nodeValue[i] ?? -1),
					document: children.get(i),
					bounds: row === undefined ? undefined : doc.layout.bounds[row],
					styles:
						row === undefined
							? undefined
							: Object.fromEntries(
									SNAPSHOT_STYLES.map((key, k) => [
										key,
										text(doc.layout.styles[row]?.[k] ?? -1),
									]),
								),
				};
			}),
		};
	});
}

interface Options {
	cdp: Cdp;
	fs: Fs;
	dir: string;
	scrubber: Scrubber;
	timer: Timer;
	wall?: WallClock;
	active(): string | undefined;
	saved(
		event: {
			at: number;
			type: "snapshot";
			trigger: string;
			structure: string;
			sourceAt?: number;
		},
		session: string,
	): void;
}

/** Saves bounded page structure at events and periodic checkpoints without interrupting recording. */
export class PageSnapshots implements Resource {
	private readonly wall: WallClock;
	private readonly interval: Resource;
	private readonly timer: Timer;
	private pending = Promise.resolve();
	private busy = false;
	private stopped = false;
	private bytes = 0;
	private count = 0;
	private readonly previous = new Map<string, { data: string; path: string }>();
	constructor(private readonly opts: Options) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.timer = opts.timer;
		this.interval = this.timer.setInterval(() => {
			const session = opts.active();
			if (session) {
				this.capture(session, "periodic");
			}
		}, Duration.secs(5));
	}
	capture(session: string, trigger: string, sourceAt?: number): void {
		if (
			this.stopped ||
			this.busy ||
			this.bytes >= MAX_BYTES ||
			this.count >= 1000
		) {
			return;
		}
		this.busy = true;
		const at = this.wall.now();
		this.pending = (async () => {
			let raw: ChromeSnapshot | undefined;
			const request = this.opts.cdp
				.send<ChromeSnapshot>(
					"DOMSnapshot.captureSnapshot",
					{ computedStyles: SNAPSHOT_STYLES, includeDOMRects: true },
					session,
				)
				.then((result) => {
					raw = result;
				});
			if (!(await timeouts.race(this.timer, request, Duration.secs(2)))) {
				this.dispose();
				return;
			}
			await request;
			if (!raw) {
				return;
			}
			const data = JSON.stringify({
				version: 1,
				computedStyles: SNAPSHOT_STYLES,
				documents: cleanSnapshot(raw, this.opts.scrubber),
			});
			const size = new TextEncoder().encode(data).byteLength;
			if (size > MAX_CAPTURE_BYTES || this.bytes + size > MAX_BYTES) {
				return;
			}
			let path = this.previous.get(session)?.path;
			if (this.previous.get(session)?.data !== data) {
				path = `${SNAPSHOTS_DIR}/${String(++this.count).padStart(4, "0")}.json`;
				await this.opts.fs.mkdir(`${this.opts.dir}/${SNAPSHOTS_DIR}`, {
					recursive: true,
				});
				await this.opts.fs.write(`${this.opts.dir}/${path}`, data);
				this.bytes += size;
				this.previous.set(session, { data, path });
			}
			if (path) {
				this.opts.saved(
					{
						at,
						type: "snapshot",
						trigger,
						sourceAt,
						structure: path,
					},
					session,
				);
			}
		})()
			.catch(() => undefined)
			.finally(() => {
				this.busy = false;
			});
	}
	flush(): Promise<void> {
		return this.pending;
	}
	dispose(): void {
		this.stopped = true;
		this.interval.dispose();
	}
}
