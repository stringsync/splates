import { dirname, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";
import { MIC_PAGE, MIC_PAGE_HTML } from "../mic-page";

/** The control page's routes, to spread into `Bun.serve`'s: `/` is the page. */
export function controlRoutes(): Record<string, () => Promise<Response>> {
	// The page is built on the first request and kept for every later one.
	const serve = (part: keyof ControlPage, type: string) => async () =>
		new Response((await controlPage())[part], {
			headers: { "content-type": `${type}; charset=utf-8` },
		});
	return {
		"/": serve("html", "text/html"),
		"/control.js": serve("js", "text/javascript"),
		"/control.css": serve("css", "text/css"),
		[MIC_PAGE]: async () =>
			new Response(MIC_PAGE_HTML, { headers: { "content-type": "text/html" } }),
	};
}

/** The control page, built: its shell, its script with React in it, and its stylesheet with Tailwind compiled. */
export interface ControlPage {
	html: string;
	js: string;
	css: string;
}

const here = import.meta.dir;

let built: Promise<ControlPage> | undefined;

function controlPage(): Promise<ControlPage> {
	built ??= buildControl();
	return built;
}

/** Builds the control page in memory, ready to serve. */
export async function buildControl(): Promise<ControlPage> {
	// rec runs from source in whatever folder the person starts it in, so the
	// build cannot lean on a `bunfig.toml` there: the script goes through
	// `Bun.build` and the stylesheet through Tailwind's compiler, both from
	// this folder.
	const [js, css, html] = await Promise.all([
		script(),
		styles(),
		Bun.file(`${here}/index.html`).text(),
	]);
	return { html, js, css };
}

async function script(): Promise<string> {
	const built = await Bun.build({
		entrypoints: [`${here}/main.tsx`],
		target: "browser",
		define: { "process.env.NODE_ENV": '"production"' },
		minify: true,
		throw: false,
	});
	const output = built.outputs.find(({ kind }) => kind === "entry-point");
	if (!built.success || !output) {
		throw new Error(
			`the control page did not build:\n${built.logs.map(String).join("\n")}`,
		);
	}
	return output.text();
}

/** The stylesheet, with only the utilities the page uses. */
async function styles(): Promise<string> {
	const compiler = await compile(await Bun.file(`${here}/styles.css`).text(), {
		base: here,
		loadStylesheet: async (id: string, from: string) => {
			const path = id.startsWith(".")
				? resolve(from, id)
				: await stylesheet(id);
			return {
				path,
				base: dirname(path),
				content: await Bun.file(path).text(),
			};
		},
	});
	return compiler.build(new Scanner({ sources: compiler.sources }).scan());
}

/**
 * Where a stylesheet package's CSS is: its `style` export, which Bun's
 * resolver does not follow, so the package is found by walking up to it.
 */
async function stylesheet(id: string): Promise<string> {
	for (let dir = here; ; dir = dirname(dir)) {
		const root = `${dir}/node_modules/${id}`;
		const manifest = Bun.file(`${root}/package.json`);
		if (await manifest.exists()) {
			const { exports, style } = await manifest.json();
			return resolve(root, exports?.["."]?.style ?? style ?? "index.css");
		}
		if (dir === dirname(dir)) {
			throw new Error(`no stylesheet package '${id}' above ${here}`);
		}
	}
}
