import { type JSX, use } from "react";
import { cn } from "#dev/lib/utils.ts";
import { MATERIAL_ICONS, type MaterialIcon } from "./material-icons";
import { OpenerContext } from "./openers";
import { split } from "./work";

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

/** A file as the page shows one: bordered and set as code. */
const chip =
	"flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs hover:bg-muted";

/**
 * What a file chip says: the logo of its language, its name, with the lines
 * it covers, then its directory dimmed. Only the directory gives way when
 * they do not fit, so the name always shows.
 */
function FileLabel({
	path,
	shown,
	lines = null,
}: {
	path: string;
	/** The path as the page shows it, from the top of its tree. */
	shown: string;
	/** The lines it covers, "1-80". */
	lines?: string | null;
}): JSX.Element {
	const { name, dir } = split(shown);
	return (
		<>
			<FileIcon path={path} className="size-3" />
			<span className="max-w-full shrink-0 truncate">
				{name}
				{lines !== null && `#L${lines}`}
			</span>
			{dir !== "" && (
				<span className="min-w-0 truncate text-muted-foreground">{dir}</span>
			)}
		</>
	);
}

/** A file a tool call worked on, opening in the person's editor at its first line. */
export function FileChip({
	path,
	shown,
	lines = null,
}: {
	path: string;
	shown: string;
	lines?: string | null;
}): JSX.Element {
	return (
		<a
			href={use(OpenerContext).url(
				path,
				lines === null ? null : Number(lines.split("-")[0]),
			)}
			title={path}
			onClick={(event) => event.stopPropagation()}
			className={cn(chip, "min-w-0 text-foreground/90")}
		>
			<FileLabel path={path} shown={shown} lines={lines} />
		</a>
	);
}
