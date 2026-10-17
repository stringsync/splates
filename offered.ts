import type { Fs } from "webappwiz/system";
import type { Conversation } from "./conversation";
import type { Setting } from "./conversations";

/** The file's own format. */
const FORMAT = 1;

/**
 * The agent settings offered across projects, with defaults changed only by
 * user selections. Session reports can refresh available options without
 * replacing the values the person picked.
 */
export class Offered {
	/** Read once, then kept: this process is the one writing it. */
	private known: Promise<Record<string, Setting[]>> | null = null;
	/** Set when a newer arbor wrote the file, which this one leaves alone. */
	private newer = false;
	/** Writes one after another, so none is lost to another. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		/** `~/.arbor/offered.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** Every agent's settings, by its id; none for one never started. */
	async all(): Promise<Record<string, Setting[]>> {
		this.known ??= this.read();
		return this.known;
	}

	/**
	 * Keeps `settings` as what `agent`'s sessions offer from now on, or, with
	 * `preserveChoices`, refreshes options while keeping existing default values.
	 */
	async remember(
		agent: string,
		settings: Setting[],
		{ preserveChoices = false }: { preserveChoices?: boolean } = {},
	): Promise<void> {
		const all = await this.all();
		const previous = all[agent] ?? [];
		const next = preserveChoices
			? [
					...previous.map((setting) => ({
						...(settings.find((each) => each.id === setting.id) ?? setting),
						current: setting.current,
					})),
					...settings.filter(
						(setting) => !previous.some((each) => each.id === setting.id),
					),
				]
			: settings;
		const known = { ...all, [agent]: next };
		this.known = Promise.resolve(known);
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(known));
		}
		return this.writing;
	}

	/** Saves only settings the person selected, leaving other defaults alone. */
	async choose(
		agent: string,
		settings: Setting[],
		ids: string[],
	): Promise<void> {
		const previous = (await this.all())[agent] ?? settings;
		await this.remember(
			agent,
			previous.map((setting) =>
				ids.includes(setting.id)
					? (settings.find((each) => each.id === setting.id) ?? setting)
					: setting,
			),
		);
	}

	/** Tracks capabilities separately from explicit choices, including the opening form. */
	track(
		conversation: Conversation,
		changed: () => void,
		picks?: Record<string, string>,
	): void {
		let remembered = conversation.state.settings;
		conversation.events.on("changed", () => {
			const { agent, settings } = conversation.state;
			if (settings !== remembered && settings.length > 0) {
				remembered = settings;
				void this.remember(agent, settings, { preserveChoices: true })
					.then(changed)
					.catch(() => {});
			}
		});
		conversation.events.on("chosen", (id) => {
			void this.choose(conversation.state.agent, conversation.state.settings, [
				id,
			])
				.then(changed)
				.catch(() => {});
		});
		if (picks !== undefined) {
			void conversation.opening
				?.then(async () => {
					await this.choose(
						conversation.state.agent,
						conversation.state.settings.map((setting) => ({
							...setting,
							current: picks[setting.id] ?? setting.current,
						})),
						Object.keys(picks),
					);
					changed();
				})
				.catch(() => {});
		}
	}

	private async read(): Promise<Record<string, Setting[]>> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		try {
			const parsed = JSON.parse(raw ?? "{}") as {
				format?: number;
				agents?: Record<string, Setting[]>;
			};
			// Only a cache: one it cannot read starts over rather than refusing.
			this.newer = (parsed.format ?? FORMAT) > FORMAT;
			return this.newer ? {} : (parsed.agents ?? {});
		} catch {
			return {};
		}
	}

	private async write(agents: Record<string, Setting[]>): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, agents }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
	}
}
