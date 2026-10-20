import { basename, dirname, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

/**
 * Builds the `splates server` page: the React app as scripts loaded on demand, and the stylesheet
 * with Tailwind compiled, into `../server/web-build`. server's `assets.ts`
 * imports both as text, so they end up inside the bundle a release publishes
 * and the server hands them straight to the browser.
 *
 * This runs here rather than on the first page load of every `splates server`, which
 * is what keeps React and Tailwind out of the published dependencies: a person
 * installing the CLI has no use for a toolchain that already ran. It is also
 * the only place the compile can read our own configuration, since `splates server`
 * runs inside whatever repository the user is in.
 *
 * `bun run build` in this package or in splates's, which a release runs, and
 * `bun install` at the workspace root, which is what puts the output there for
 * a fresh checkout.
 */

const here = import.meta.dirname;
const out = `${here}/../server/web-build`;

/** The app icon's sizes, the two a manifest needs for an install. */
const ICON_SIZES = [192, 512] as const;

/** A script and its source map. */
interface Built {
	code: string;
	map: string;
}

/**
 * A browser script, with what it imports in it: the page's, with React and
 * its modules, or the service worker's. Its source map comes with it. The
 * page's is split where it loads a page on demand, into `chunks` the script
 * fetches by name when first needed: a name holds its content's hash, so
 * the same name is the same bytes. The service worker, which cannot, is one
 * file.
 */
async function script(
	entry: string,
	splitting: boolean,
): Promise<Built & { chunks: Record<string, Built> }> {
	const built = await Bun.build({
		entrypoints: [`${here}/${entry}`],
		target: "browser",
		splitting,
		naming: {
			entry: entry === "worker.ts" ? "worker.js" : "main.js",
			chunk: "chunk-[hash].js",
		},
		// React's production build: the development one is several times the
		// size, slower, and asks the person on the page to install DevTools.
		define: { "process.env.NODE_ENV": '"production"' },
		minify: true,
		// A map beside the script, so DevTools shows the original source, names
		// and lines intact. Linked rather than inline, since only DevTools asks
		// for it: inline, every page load would carry the map's ~12 MB.
		sourcemap: "linked",
		// Left to throw, a failure arrives as an AggregateError that says only
		// "Bundle failed": which import went missing is in the logs, and whoever
		// is reading the terminal needs that to know it is their install.
		throw: false,
	});
	const output = built.outputs.find(({ kind }) => kind === "entry-point");
	const map = built.outputs.find(
		({ kind, path }) => kind === "sourcemap" && path === `${output?.path}.map`,
	);
	if (output === undefined || map === undefined) {
		throw new Error(built.logs.map(String).join("\n"));
	}
	const chunks: Record<string, Built> = {};
	for (const chunk of built.outputs.filter(({ kind }) => kind === "chunk")) {
		const name = basename(chunk.path);
		const chunkMap = built.outputs.find(
			({ kind, path }) => kind === "sourcemap" && path === `${chunk.path}.map`,
		);
		if (chunkMap === undefined) {
			throw new Error(`chunk ${name} has no source map`);
		}
		chunks[name] = { code: await chunk.text(), map: await chunkMap.text() };
	}
	return { code: await output.text(), map: await map.text(), chunks };
}

/**
 * Where a package's stylesheet is: the `style` entry of its `exports`, which is
 * where CSS packages like tw-animate-css put it, or the file a path past the
 * package's name points at (`@assistant-ui/react-markdown/styles/dot.css`).
 * Bun's resolver does not follow that condition, so the package is found by
 * walking up to it.
 */
async function stylesheet(id: string): Promise<string> {
	const parts = id.split("/");
	const length = id.startsWith("@") ? 2 : 1;
	const name = parts.slice(0, length).join("/");
	const file = parts.slice(length).join("/");
	for (let dir = here; ; dir = dirname(dir)) {
		const root = `${dir}/node_modules/${name}`;
		const manifest = Bun.file(`${root}/package.json`);
		if (await manifest.exists()) {
			if (file !== "") {
				return resolve(root, file);
			}
			const { exports, style } = await manifest.json();
			const entry = exports?.["."]?.style ?? style ?? "index.css";
			return resolve(root, entry);
		}
		if (dir === dirname(dir)) {
			throw new Error(`no stylesheet package '${name}' above ${here}`);
		}
	}
}

/** The stylesheet, with only the utilities the page actually uses in it. */
async function styles(): Promise<string> {
	const base = here;
	const compiler = await compile(await Bun.file(`${base}/styles.css`).text(), {
		base,
		loadStylesheet: async (id: string, from: string) => {
			// A stylesheet is asked for by bare package name (`@import "tailwindcss"`),
			// then the parts of it by relative path. Only the bare names need module
			// resolution; the rest are paths off a base already inside the package.
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
	// The `@source` lines in styles.css say which files to read class names out
	// of. Tailwind emits only the utilities it finds there.
	return compiler.build(new Scanner({ sources: compiler.sources }).scan());
}

// All of them as `.txt`: what they hold is a blob the server hands to a browser,
// and the extensions they were authored under mean something else to a
// compiler. `.js` would have tsc typecheck a bundle that already compiled, and
// Bun's own types read `.html` and `.css` imports as something other than text.
await Bun.write(
	`${out}/shell.txt`,
	await Bun.file(`${here}/index.html`).text(),
);
for (const [name, entry, splitting] of [
	["main", "boot.ts", true],
	["worker", "worker.ts", false],
] as const) {
	const { code, map, chunks } = await script(entry, splitting);
	await Bun.write(`${out}/${name}.txt`, code);
	await Bun.write(`${out}/${name}.map.txt`, map);
	if (splitting) {
		// All the page's chunks in one text file, since the server imports its
		// assets as text and a release bundles what is imported.
		await Bun.write(`${out}/chunks.txt`, JSON.stringify(chunks));
	}
}
await Bun.write(`${out}/styles.txt`, await styles());
await Bun.write(
	`${out}/manifest.txt`,
	await Bun.file(`${here}/manifest.webmanifest`).text(),
);
// The icons as base64, so they travel as text like the rest. The PNGs are
// committed rather than drawn here, since `icons/render.swift` draws them
// with macOS's own emoji, which only a Mac has.
for (const size of ICON_SIZES) {
	const png = await Bun.file(`${here}/icons/icon-${size}.png`).bytes();
	await Bun.write(`${out}/icon-${size}.txt`, png.toBase64());
}
