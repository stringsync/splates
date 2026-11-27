/** The runtime binding the pointer script reports through, one JSON string per event. */
export const POINTER_BINDING = "__recPointer";

/** The pointer script as source to evaluate in a page: it tracks the element under the pointer, clicks, typing, routes and Option-held arrow/box highlights. */
export function pointerSource(): string {
	return `(${pointerScript.toString()})(${JSON.stringify(POINTER_BINDING)})`;
}

// Runs in the page, so it uses nothing from this file but its argument.
function pointerScript(binding: string): void {
	const win = window as unknown as Record<string, unknown>;
	if (window !== window.top || win.__recPointerInstalled) {
		return;
	}
	win.__recPointerInstalled = true;
	const report = win[binding] as ((payload: string) => void) | undefined;
	if (typeof report !== "function") {
		return;
	}
	const SAMPLE_MS = 100;
	const REST_MS = 300;
	const TYPE_GAP_MS = 1500;
	const FADE_MS = 1500;
	const DEAD_MS = 500;
	const INK = "#ff1f8f";
	const STROKE = 4;
	const MIN_DRAG = STROKE * 3;

	const clip = (text: string, max: number): string =>
		text.replace(/\s+/g, " ").trim().slice(0, max);

	const componentOf = (el: Element): string | undefined => {
		let node: Element | null = el;
		while (node) {
			const key = Object.keys(node).find((prop) =>
				prop.startsWith("__reactFiber$"),
			);
			if (key) {
				let fiber = (node as unknown as Record<string, unknown>)[key] as
					| { type?: unknown; return?: unknown }
					| null
					| undefined;
				while (fiber) {
					const type = fiber.type as
						| string
						| {
								displayName?: string;
								name?: string;
								render?: { displayName?: string; name?: string };
								type?: { displayName?: string; name?: string };
						  }
						| null
						| undefined;
					if (type && typeof type !== "string") {
						const name =
							type.displayName ||
							type.name ||
							type.render?.displayName ||
							type.render?.name ||
							type.type?.displayName ||
							type.type?.name;
						if (name) {
							return name;
						}
					}
					fiber = fiber.return as typeof fiber;
				}
			}
			node = node.parentElement;
		}
		return (
			el.closest("[data-component]")?.getAttribute("data-component") ??
			undefined
		);
	};

	const selectorOf = (el: Element): string => {
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node !== document.documentElement && parts.length < 3) {
			const tag = node.tagName.toLowerCase();
			const id = node.getAttribute("id");
			if (id && !/\d{4,}/.test(id)) {
				parts.unshift(`${tag}#${CSS.escape(id)}`);
				break;
			}
			const testId =
				node.getAttribute("data-testid") ?? node.getAttribute("data-test");
			if (testId) {
				parts.unshift(`${tag}[data-testid="${testId}"]`);
				break;
			}
			const classes = [...node.classList]
				.filter((cls) => cls.length < 30 && !/\d{3,}/.test(cls))
				.slice(0, 2)
				.map((cls) => `.${CSS.escape(cls)}`)
				.join("");
			parts.unshift(`${tag}${classes}`);
			node = node.parentElement;
		}
		return parts.join(" > ");
	};

	/** Visible text of an element; a field's own value is never read. */
	const textOf = (el: Element): string => {
		if (
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement
		) {
			return clip(
				el.getAttribute("aria-label") ??
					el.getAttribute("placeholder") ??
					el.getAttribute("name") ??
					"",
				80,
			);
		}
		return clip((el as HTMLElement).innerText ?? el.textContent ?? "", 80);
	};

	const describe = (el: Element) => {
		const rect = el.getBoundingClientRect();
		return {
			component: componentOf(el),
			selector: selectorOf(el),
			text: textOf(el),
			box: [
				Math.round(rect.x),
				Math.round(rect.y),
				Math.round(rect.width),
				Math.round(rect.height),
			],
		};
	};

	const send = (event: Record<string, unknown>): void => {
		report(JSON.stringify({ at: Date.now(), ...event }));
	};

	const pointer = { x: -1, y: -1, seen: false, moved: false };
	let restTimer: ReturnType<typeof setTimeout> | undefined;
	const under = (): Element | null =>
		pointer.seen ? document.elementFromPoint(pointer.x, pointer.y) : null;

	// Highlight: hold Option to draw an arrow, or Option+Command to draw a box.
	// Releasing freezes the shape in place while its still is captured, then fades it out.
	type Shape = "arrow" | "box";
	let drawing:
		| {
				shape: Shape;
				from?: { x: number; y: number };
				to?: { x: number; y: number };
				lockedBox: boolean;
		  }
		| undefined;
	let canvas: HTMLCanvasElement | undefined;
	let fade: ReturnType<typeof setTimeout> | undefined;
	const paint = (): void => {
		if (!canvas || !drawing?.from || !drawing.to) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(rect.width * dpr);
		const targetH = Math.round(rect.height * dpr);
		if (canvas.width !== targetW || canvas.height !== targetH) {
			canvas.width = targetW;
			canvas.height = targetH;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, rect.width, rect.height);
		const { from, to, shape } = drawing;
		if (Math.hypot(to.x - from.x, to.y - from.y) < 2) {
			return;
		}
		const path = new Path2D();
		if (shape === "box") {
			path.rect(
				Math.min(from.x, to.x),
				Math.min(from.y, to.y),
				Math.abs(to.x - from.x),
				Math.abs(to.y - from.y),
			);
		} else {
			const angle = Math.atan2(to.y - from.y, to.x - from.x);
			const head = STROKE * 4;
			path.moveTo(from.x, from.y);
			path.lineTo(to.x, to.y);
			for (const side of [-1, 1]) {
				path.moveTo(to.x, to.y);
				path.lineTo(
					to.x - head * Math.cos(angle + side * 0.5),
					to.y - head * Math.sin(angle + side * 0.5),
				);
			}
		}
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
		ctx.shadowBlur = STROKE * 1.5;
		ctx.strokeStyle = "white";
		ctx.lineWidth = STROKE * 2;
		ctx.stroke(path);
		ctx.shadowColor = "transparent";
		ctx.strokeStyle = INK;
		ctx.lineWidth = STROKE;
		ctx.stroke(path);
		ctx.restore();
	};
	const collectElements = (
		shape: Shape,
		from: { x: number; y: number },
		to: { x: number; y: number },
	): Element[] => {
		const seen: Element[] = [];
		const probe = (px: number, py: number): void => {
			const el = document.elementFromPoint(px, py);
			if (el && !seen.includes(el)) {
				seen.push(el);
			}
		};
		if (shape === "arrow") {
			probe(to.x, to.y);
			probe(from.x, from.y);
		} else {
			const left = Math.min(from.x, to.x);
			const top = Math.min(from.y, to.y);
			const width = Math.abs(to.x - from.x);
			const height = Math.abs(to.y - from.y);
			for (const fy of [0.5, 0.2, 0.8]) {
				for (const fx of [0.5, 0.2, 0.8]) {
					probe(left + width * fx, top + height * fy);
				}
			}
		}
		return seen.slice(0, 6);
	};
	const startShape = (shape: Shape): void => {
		clearTimeout(fade);
		canvas?.remove();
		canvas = document.createElement("canvas");
		canvas.style.cssText =
			"position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;transition:opacity .4s";
		document.documentElement.append(canvas);
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		const start = pointer.seen ? { x: pointer.x, y: pointer.y } : undefined;
		drawing = {
			shape,
			from: start,
			to: start ? { ...start } : undefined,
			lockedBox: shape === "box",
		};
		send({ type: "laser", on: true, shape });
	};
	const cancelShape = (): void => {
		if (!drawing) {
			return;
		}
		drawing = undefined;
		clearTimeout(fade);
		canvas?.remove();
		canvas = undefined;
		send({ type: "laser", on: false });
	};
	const endShape = (): void => {
		const current = drawing;
		drawing = undefined;
		send({ type: "laser", on: false });
		const shown = canvas;
		if (
			!current?.from ||
			!current.to ||
			Math.hypot(current.to.x - current.from.x, current.to.y - current.from.y) <
				MIN_DRAG
		) {
			shown?.remove();
			if (canvas === shown) {
				canvas = undefined;
			}
			return;
		}
		fade = setTimeout(() => {
			if (shown) {
				shown.style.opacity = "0";
			}
			setTimeout(() => shown?.remove(), 500);
		}, FADE_MS);
		const { from, to, shape } = current;
		const left = Math.min(from.x, to.x);
		const top = Math.min(from.y, to.y);
		const width = Math.abs(to.x - from.x);
		const height = Math.abs(to.y - from.y);
		const unique = collectElements(shape, from, to);
		send({
			type: "highlight",
			shape,
			from: [Math.round(from.x), Math.round(from.y)],
			to: [Math.round(to.x), Math.round(to.y)],
			path: [
				[Math.round(from.x), Math.round(from.y)],
				[Math.round(to.x), Math.round(to.y)],
			],
			area: [
				Math.round(left),
				Math.round(top),
				Math.round(width),
				Math.round(height),
			],
			elements: unique.map(describe),
		});
	};

	const sample = (): void => {
		const el = under();
		if (!el) {
			return;
		}
		send({ type: "move", x: pointer.x, y: pointer.y, ...describe(el) });
	};
	let lastSample = 0;
	document.addEventListener(
		"pointermove",
		(event) => {
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			pointer.seen = true;
			if (drawing) {
				const pt = { x: event.clientX, y: event.clientY };
				drawing.from ??= pt;
				drawing.to = pt;
				paint();
			}
			const now = Date.now();
			if (now - lastSample >= SAMPLE_MS) {
				lastSample = now;
				sample();
			}
			clearTimeout(restTimer);
			restTimer = setTimeout(() => {
				const el = under();
				if (el && !drawing) {
					send({ type: "rest", x: pointer.x, y: pointer.y, ...describe(el) });
				}
			}, REST_MS);
		},
		true,
	);
	// A click is dead when nothing in the page changes and the route stays put for a while after it.
	let changed = 0;
	new MutationObserver(() => {
		changed++;
	}).observe(document, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	document.addEventListener(
		"click",
		(event) => {
			if (event.target instanceof Element) {
				const target = event.target;
				const at = Date.now();
				const before = changed;
				const href = location.href;
				const info = describe(target);
				send({
					type: "click",
					x: event.clientX,
					y: event.clientY,
					...info,
				});
				setTimeout(() => {
					if (changed === before && location.href === href) {
						report(JSON.stringify({ at, type: "quiet", ...info }));
					}
				}, DEAD_MS);
			}
		},
		true,
	);

	// Error text appearing on the page: alerts, toasts and the usual apologies.
	const ERROR_TEXT =
		/something went wrong|an error occurred|failed to|unable to|could not|couldn't|try again|error:/i;
	const alerted = new Set<string>();
	const inspect = (node: Node): void => {
		if (!(node instanceof HTMLElement)) {
			return;
		}
		const roled = node.matches('[role="alert"]')
			? node
			: node.querySelector('[role="alert"]');
		const toast = node.matches('[class*="toast" i], [data-sonner-toast]')
			? node
			: node.querySelector('[class*="toast" i], [data-sonner-toast]');
		const shown = roled ?? toast ?? node;
		const text = clip((shown as HTMLElement).innerText ?? "", 120);
		if (!text) {
			return;
		}
		const kind = roled ? "alert" : toast ? "toast" : "text";
		if ((kind === "text" && !ERROR_TEXT.test(text)) || alerted.has(text)) {
			return;
		}
		alerted.add(text);
		setTimeout(() => alerted.delete(text), 5000);
		send({ ...describe(shown), type: "alert", kind, text });
	};
	new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node instanceof HTMLElement && node.tagName !== "CANVAS") {
					inspect(node);
				}
			}
		}
	}).observe(document, { subtree: true, childList: true });
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Alt") {
				if (!drawing && !event.repeat) {
					startShape(event.metaKey ? "box" : "arrow");
				}
				return;
			}
			if (event.key === "Meta") {
				if (drawing && !drawing.lockedBox) {
					drawing.shape = "box";
					drawing.lockedBox = true;
					paint();
					send({ type: "laser", on: true, shape: "box" });
				}
				return;
			}
			if (drawing && event.key !== "Shift" && event.key !== "Control") {
				// Another key was pressed with Option/Command (e.g. DevTools or word-jump): cancel without capturing.
				cancelShape();
			}
		},
		true,
	);
	document.addEventListener(
		"keyup",
		(event) => {
			if (!drawing) {
				return;
			}
			if (event.key === "Alt" || (event.key === "Meta" && drawing.lockedBox)) {
				endShape();
			}
		},
		true,
	);
	window.addEventListener("blur", () => {
		if (drawing) {
			endShape();
		}
	});

	// Typing is reported once per burst, as where it went, never what it was.
	const typing = new WeakMap<Element, number>();
	document.addEventListener(
		"input",
		(event) => {
			const el = event.target;
			if (!(el instanceof Element)) {
				return;
			}
			const now = Date.now();
			const last = typing.get(el) ?? 0;
			typing.set(el, now);
			if (now - last > TYPE_GAP_MS) {
				send({ type: "type", ...describe(el) });
			}
		},
		true,
	);

	// Route changes, including the page's first.
	let route = "";
	const routed = (): void => {
		const url = location.href;
		if (url !== route) {
			route = url;
			send({ type: "route", url });
		}
	};
	for (const name of ["pushState", "replaceState"] as const) {
		const original = history[name].bind(history);
		history[name] = (...args: Parameters<History["pushState"]>) => {
			original(...args);
			routed();
		};
	}
	window.addEventListener("popstate", routed);
	window.addEventListener("hashchange", routed);
	routed();
}
