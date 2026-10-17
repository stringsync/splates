/**
 * The conversations the page opened, in order, for ⌥⌘, to go back through
 * and ⌥⌘. to go forward through, as in a browser's history. Kept for the
 * page only, so a reload starts it over.
 */
export class Visits {
	private readonly opened: string[] = [];
	/** Where in `opened` the page is, or -1 before it opens any. */
	private at = -1;
	/** Whether the page left `opened[at]` for none, such as a new one. */
	private away = false;

	/**
	 * Records that the page opened `id`, dropping what was ahead of where it
	 * was, unless it is where the page already is.
	 */
	visit(id: string): void {
		this.away = false;
		if (this.opened[this.at] === id) {
			return;
		}
		this.opened.splice(this.at + 1);
		this.opened.push(id);
		this.at = this.opened.length - 1;
	}

	/** Records that the page shows none of them, so back returns to the last. */
	leave(): void {
		this.away = this.at !== -1;
	}

	/** The nearest one before, past any `exists` refuses, or null when none. */
	back(exists: (id: string) => boolean): string | null {
		return this.step(this.away ? 0 : -1, -1, exists);
	}

	/** The nearest one after, past any `exists` refuses, or null when none. */
	forward(exists: (id: string) => boolean): string | null {
		return this.step(1, 1, exists);
	}

	private step(
		from: number,
		by: 1 | -1,
		exists: (id: string) => boolean,
	): string | null {
		for (let to = this.at + from; to >= 0; to += by) {
			const id = this.opened[to];
			if (id === undefined) {
				return null;
			}
			if (exists(id)) {
				this.at = to;
				this.away = false;
				return id;
			}
		}
		return null;
	}
}
