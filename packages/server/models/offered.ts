import type { Conversation, Setting } from "../conversations";
import type { Document } from "../storage";

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
	/** Whether each agent last said it takes images, read with {@link known}. */
	private images: Record<string, boolean> = {};
	/** Set when a newer splates wrote the file, which this one leaves alone. */
	private newer = false;
	/** Writes one after another, so none is lost to another. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		/** `~/.splates/offered.json`, or a test's own. */
		private readonly doc: Document<{
			format?: number;
			agents?: Record<string, Setting[]>;
			images?: Record<string, boolean>;
		}>,
	) {}

	/** Every agent's settings, by its id; none for one never started. */
	async all(): Promise<Record<string, Setting[]>> {
		this.known ??= this.read();
		return this.known;
	}

	/** Whether each agent that connected here last said it takes images, by its id. */
	async sights(): Promise<Record<string, boolean>> {
		await this.all();
		return this.images;
	}

	/** Keeps whether `agent` said it takes images, which Auto pick reads before it connects. */
	async see(agent: string, sees: boolean): Promise<void> {
		const all = await this.all();
		if (this.images[agent] === sees) {
			return;
		}
		this.images = { ...this.images, [agent]: sees };
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(all));
		}
		return this.writing;
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
		let sawImages: boolean | null = null;
		conversation.events.on("changed", () => {
			// Kept for Auto pick, which decides before an agent connects.
			const sees = conversation.sees;
			if (sees !== null && sees !== sawImages) {
				sawImages = sees;
				void this.see(conversation.state.agent, sees).catch(() => {});
			}
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
		try {
			const parsed = (await this.doc.read()) ?? {};
			// Only a cache: one it cannot read starts over rather than refusing.
			this.newer = (parsed.format ?? FORMAT) > FORMAT;
			this.images = this.newer ? {} : (parsed.images ?? {});
			return this.newer ? {} : (parsed.agents ?? {});
		} catch {
			return {};
		}
	}

	private async write(agents: Record<string, Setting[]>): Promise<void> {
		await this.doc.write({ format: FORMAT, agents, images: this.images });
	}
}
