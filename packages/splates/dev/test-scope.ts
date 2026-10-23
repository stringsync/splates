import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Git } from "@stringsync/splates-server/git";
import { type Fs, NodeFs } from "webappwiz/system";
import { ROOT } from "./root";

export interface ScopeCount {
	selected: number;
	total: number;
}

/** Counts files without loading tests or running their setup. Unknown graphs fail closed. */
export class TestScope {
	constructor(
		private readonly repo = new Git(ROOT),
		private readonly fs: Fs = new NodeFs(),
		private readonly resolveImport = Bun.resolveSync,
	) {}

	async count(opts: TestScopeOptions): Promise<ScopeCount> {
		const files = await this.git(
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
		);
		const candidates = files.filter(
			(file) =>
				!file
					.split("/")
					.some((part) => part.startsWith(".") || part === "node_modules") &&
				/(?:\.(?:test|spec)|_(?:test|spec))\.[cm]?[jt]sx?$/.test(file) &&
				(opts.all || !file.startsWith("evals/")),
		);
		const tests: string[] = [];
		for (const file of candidates) {
			if (await this.fs.exists(resolve(this.repo.root, file))) {
				tests.push(file);
			}
		}
		let selected = tests.filter(
			(file) =>
				!opts.files?.length ||
				opts.files.some((filter) =>
					file.includes(
						relative(this.repo.root, resolve(this.repo.root, filter)),
					),
				),
		);
		if (opts.changed || opts.since) {
			const changed = new Set([
				...(await this.git(
					"diff",
					"--name-only",
					"-z",
					opts.since ?? "HEAD",
					"--",
				)),
				...(await this.git("ls-files", "--others", "--exclude-standard", "-z")),
			]);
			// Configuration and resolution changes can affect every import. Deleted
			// files and failed resolutions below also leave the upper bound intact.
			if (
				![...changed].some((file) =>
					/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|bunfig\.toml|bun\.lockb?)$/.test(
						file,
					),
				)
			) {
				const affected = await this.affected(selected, changed);
				selected = selected.filter((file) => affected.has(file));
			}
		}
		return { selected: selected.length, total: tests.length };
	}

	private async git(...args: string[]): Promise<string[]> {
		const output = await this.repo.out(this.repo.root, ...args);
		return [...new Set(output.split("\0").filter(Boolean))];
	}

	private async affected(
		files: string[],
		changed: Set<string>,
	): Promise<Set<string>> {
		const parents = new Map<string, Set<string>>();
		const ts = new Bun.Transpiler({ loader: "ts" });
		const tsx = new Bun.Transpiler({ loader: "tsx" });
		const uncertain = new Set<string>();
		const visited = new Set<string>();
		const modules = [...files];
		if (files.some((file) => file.startsWith("packages/web/"))) {
			modules.push("packages/web/test-preload.ts");
		}
		for (let file = modules.pop(); file !== undefined; file = modules.pop()) {
			if (visited.has(file)) {
				continue;
			}
			visited.add(file);
			if (
				file.startsWith(".wiz/") ||
				!/\.[cm]?[jt]sx?$/.test(file) ||
				file.endsWith(".d.ts")
			) {
				continue;
			}
			const scanner = file.endsWith("x") ? tsx : ts;
			let imports: ReturnType<typeof scanner.scanImports>;
			try {
				imports = scanner.scanImports(
					await this.fs.read(resolve(this.repo.root, file)),
				);
			} catch {
				uncertain.add(file);
				continue;
			}
			for (const entry of imports) {
				let dependency: string;
				try {
					dependency = this.resolveImport(
						entry.path,
						dirname(resolve(this.repo.root, file)),
					);
				} catch {
					uncertain.add(file);
					continue;
				}
				if (!isAbsolute(dependency)) {
					continue;
				}
				const name = relative(this.repo.root, dependency);
				if (
					name.startsWith("../") ||
					name.split("/").includes("node_modules")
				) {
					continue;
				}
				modules.push(name);
				const users = parents.get(name) ?? new Set<string>();
				users.add(file);
				parents.set(name, users);
			}
		}
		// A preload is an implicit import of every web test.
		for (const file of files.filter((file) =>
			file.startsWith("packages/web/"),
		)) {
			const users =
				parents.get("packages/web/test-preload.ts") ?? new Set<string>();
			users.add(file);
			parents.set("packages/web/test-preload.ts", users);
		}
		const affected = new Set([...changed, ...uncertain]);
		const pending = [...affected];
		for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
			for (const user of parents.get(file) ?? []) {
				if (affected.has(user)) {
					continue;
				}
				affected.add(user);
				pending.push(user);
			}
		}
		return affected;
	}
}

/** Which files a scoped run may load before filtering individual test names. */
export interface TestScopeOptions {
	all?: boolean;
	changed?: boolean;
	since?: string;
	files?: string[];
}
