import { FolderIcon } from "lucide-react";
import { type JSX, use } from "react";
import { cn } from "#dev/lib/utils.ts";
import { openFile } from "./api";
import { MATERIAL_ICONS, type MaterialIcon } from "./material-icons";
import { OpenerContext } from "./openers";
import { split } from "./work";

/** The icon of the language `path` is written in, as Material Icon Theme draws it. */
export function FileIcon({
	path,
	className,
}: {
	path: string;
	className?: string;
}): JSX.Element {
	return (
		<img
			alt=""
			src={`data:image/svg+xml,${encodeURIComponent(MATERIAL_ICONS[iconOf(split(path).name)])}`}
			className={cn("shrink-0", className)}
		/>
	);
}

/** Hosts that put the page on the machine `arbor dev` runs on, where it can start the person's editor. */
const HERE = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A file as the page shows one: bordered and set as code. */
const chip =
	"flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs hover:bg-muted";

/**
 * A file a tool call worked on or a message names, opening in the person's
 * editor at its first line: the logo of its language, then its name with the
 * lines it covers. On the machine `arbor dev` runs on, `dev` opens it inside
 * the worktree it is in, which its link cannot say; elsewhere, or when that
 * fails, the link opens the file alone. A directory, its path ending in `/`, shows a folder. The
 * whole path is its tooltip.
 */
export function FileChip({
	path,
	name,
	lines = null,
	className,
}: {
	path: string;
	/** What it is called, its own name unless another beside it shares that. */
	name?: string | undefined;
	/** The lines it covers, "1-80". */
	lines?: string | null;
	className?: string;
}): JSX.Element {
	const directory = path.endsWith("/");
	const opener = use(OpenerContext);
	const line = lines === null ? null : Number(lines.split("-")[0]);
	const href = opener.url(path, line);
	return (
		<a
			href={href}
			title={path}
			onClick={(event) => {
				event.stopPropagation();
				if (HERE.has(location.hostname)) {
					event.preventDefault();
					openFile(opener.id, path, line).catch(() => location.assign(href));
				}
			}}
			className={cn(chip, "min-w-0 text-foreground/90", className)}
		>
			{directory ? (
				<FolderIcon
					aria-hidden
					className="size-3 shrink-0 text-muted-foreground"
				/>
			) : (
				<FileIcon path={path} className="size-3" />
			)}
			<span className="min-w-0 truncate">
				{name ?? distinctNames([path]).get(path)}
				{lines !== null && `#L${lines}`}
			</span>
		</a>
	);
}

/**
 * What each of `paths` is called on its chip: its own name, a directory's
 * with its `/`, and where two or more share one, as many of the directories
 * above as it takes to tell them apart.
 */
export function distinctNames(paths: readonly string[]): Map<string, string> {
	const parts = new Map(
		[...new Set(paths)].map((path) => [
			path,
			path.replace(/\/$/, "").split("/"),
		]),
	);
	const depth = new Map([...parts.keys()].map((path) => [path, 1]));
	const nameOf = (path: string) =>
		(parts.get(path) ?? []).slice(-(depth.get(path) ?? 1)).join("/") +
		(path.endsWith("/") ? "/" : "");
	for (let grew = true; grew; ) {
		grew = false;
		const byName = new Map<string, string[]>();
		for (const path of parts.keys()) {
			byName.set(nameOf(path), [...(byName.get(nameOf(path)) ?? []), path]);
		}
		for (const alike of byName.values()) {
			for (const path of alike.length < 2 ? [] : alike) {
				const at = depth.get(path) ?? 1;
				if (at < (parts.get(path)?.length ?? 1)) {
					depth.set(path, at + 1);
					grew = true;
				}
			}
		}
	}
	return new Map([...parts.keys()].map((path) => [path, nameOf(path)]));
}

/** Each extension's icon. */
const EXTENSIONS: Record<string, MaterialIcon> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "react-ts",
	jsx: "react",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rs: "rust",
	go: "go",
	java: "java",
	kt: "kotlin",
	kts: "kotlin",
	swift: "swift",
	rb: "ruby",
	php: "php",
	c: "c",
	h: "h",
	cc: "cpp",
	cpp: "cpp",
	cxx: "cpp",
	hh: "hpp",
	hpp: "hpp",
	cs: "csharp",
	css: "css",
	scss: "sass",
	sass: "sass",
	less: "less",
	html: "html",
	htm: "html",
	md: "markdown",
	mdx: "markdown",
	json: "json",
	jsonc: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	xml: "xml",
	sh: "console",
	bash: "console",
	zsh: "console",
	fish: "console",
	ps1: "powershell",
	svelte: "svelte",
	vue: "vue",
	astro: "astro",
	lua: "lua",
	sql: "database",
	graphql: "graphql",
	gql: "graphql",
	prisma: "prisma",
	nix: "nix",
	zig: "zig",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hs: "haskell",
	scala: "scala",
	dart: "dart",
	lock: "lock",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	svg: "svg",
	pdf: "pdf",
	zip: "zip",
	gz: "zip",
	tar: "zip",
};

/** Files known by their whole name rather than their extension. */
const NAMES: Record<string, MaterialIcon> = {
	Dockerfile: "docker",
	".gitignore": "git",
	".gitattributes": "git",
	"package.json": "nodejs",
	"tsconfig.json": "tsconfig",
	"biome.json": "biome",
	"biome.jsonc": "biome",
	"README.md": "readme",
	LICENSE: "license",
	Makefile: "makefile",
	"CMakeLists.txt": "cmake",
	Gemfile: "gemfile",
	"bun.lock": "bun",
	"bun.lockb": "bun",
};

/** The icon for the file `name`: by its name, then its extension, else a plain page. */
function iconOf(name: string): MaterialIcon {
	if (name.endsWith(".d.ts")) {
		return "typescript-def";
	}
	return (
		NAMES[name] ??
		EXTENSIONS[name.split(".").at(-1)?.toLowerCase() ?? ""] ??
		"document"
	);
}
