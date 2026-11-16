/** The runtime binding the pointer script reports through, one JSON string per event. */
export const POINTER_BINDING = "__recPointer";

/** The pointer script as source to evaluate in a page: it tracks the element under the pointer, clicks, typing, routes and Option-held highlights. */
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
	const MAX_PATH = 200;
	const DEAD_MS = 500;

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

	// Highlight: hold Option and drag the pointer.
	let drawing: { x: number; y: number }[] | undefined;
	let seenElements: Element[] = [];
	let canvas: HTMLCanvasElement | undefined;
	let fade: ReturnType<typeof setTimeout> | undefined;
	const paint = (): void => {
		if (!canvas || !drawing) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.strokeStyle = "rgba(255, 60, 60, 0.85)";
		ctx.lineWidth = 5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		drawing.forEach((pt, i) => {
			if (i === 0) {
				ctx.moveTo(pt.x, pt.y);
			} else {
				ctx.lineTo(pt.x, pt.y);
			}
		});
		ctx.stroke();
	};
	const startTrail = (): void => {
		clearTimeout(fade);
		canvas?.remove();
		canvas = document.createElement("canvas");
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		canvas.style.cssText =
			"position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;transition:opacity .4s";
		document.documentElement.append(canvas);
		drawing = pointer.seen ? [{ x: pointer.x, y: pointer.y }] : [];
		seenElements = [];
		send({ type: "laser", on: true });
	};
	const endTrail = (): void => {
		const path = drawing;
		drawing = undefined;
		send({ type: "laser", on: false });
		const shown = canvas;
		fade = setTimeout(() => {
			if (shown) {
				shown.style.opacity = "0";
			}
			setTimeout(() => shown?.remove(), 500);
		}, FADE_MS);
		if (!path || path.length < 3) {
			return;
		}
		const xs = path.map((pt) => pt.x);
		const ys = path.map((pt) => pt.y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		const step = Math.max(1, Math.ceil(path.length / MAX_PATH));
		const unique = [...new Set(seenElements)].slice(0, 6);
		send({
			type: "highlight",
			path: path
				.filter((_, i) => i % step === 0)
				.map((pt) => [Math.round(pt.x), Math.round(pt.y)]),
			area: [
				Math.round(left),
				Math.round(top),
				Math.round(Math.max(...xs) - left),
				Math.round(Math.max(...ys) - top),
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
				drawing.push({ x: event.clientX, y: event.clientY });
				const el = document.elementFromPoint(event.clientX, event.clientY);
				if (el && seenElements.at(-1) !== el) {
					seenElements.push(el);
				}
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
			if (event.key === "Alt" && !drawing) {
				startTrail();
			}
		},
		true,
	);
	document.addEventListener(
		"keyup",
		(event) => {
			if (event.key === "Alt" && drawing) {
				endTrail();
			}
		},
		true,
	);
	window.addEventListener("blur", () => {
		if (drawing) {
			endTrail();
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
