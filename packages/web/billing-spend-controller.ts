import type {
	BillingView,
	SpendReport,
} from "@stringsync/splates-server/spend";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { billing, pullBilling, setCurrency, spend } from "./api";
import { type Span, spanOf } from "./billing-sums";

export type Range = Span | "custom";

export type SpendControllerEvents = { changed: undefined };

/** What the Spend section last read, kept across the page's visits. */
export type SpendReading = {
	range: Range;
	back: number;
	report: SpendReport | null;
	sources: BillingView | null;
};

const DAY = 86_400_000;

/**
 * What the Spend section shows and the controls that change it: pick a range,
 * step earlier or later, set a custom range's dates, pull the billing sources
 * or change the currency. Call `open` once when it mounts and `dispose` when
 * it goes; the report reads again by itself after each change.
 */
export class SpendController
	implements Eventful<SpendControllerEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<SpendControllerEvents>();
	readonly events = this.dispatcher.events;

	range: Range;
	/** How many whole spans before the one ending today the page shows. */
	back: number;
	from = "";
	to = "";
	// Held while it reads again, so a change of range never blanks the figures.
	report: SpendReport | null;
	error: string | null = null;
	sources: BillingView | null;
	pulling = false;
	/** A currency change is on its way: held until the server answers. */
	changingCurrency = false;
	sourceError: string | null = null;
	/** The range as a span of time, or null for a custom one not yet picked. */
	span: { since: string; until: string } | null = null;

	private disposed = false;
	// What the report was last asked for, so it reads only on a change.
	private asked: string | null = null;
	private reads = 0;

	constructor(
		/** Where what is read is kept, for the next visit to open on. */
		private readonly last: SpendReading,
	) {
		this.range = last.range;
		this.back = last.back;
		this.report = last.range === "custom" ? null : last.report;
		this.sources = last.sources;
		this.span = this.spanNow();
	}

	/** Reads what was last pulled at once, then pulls again, so the figures catch up. */
	open(): void {
		billing().then(
			(read) => this.setSources(read),
			(caught: Error) => this.fail("sourceError", caught.message),
		);
		this.pull();
		this.load();
	}

	setRange(range: Range): void {
		this.range = range;
		this.back = 0;
		this.changed();
	}

	earlier(): void {
		this.back += 1;
		this.changed();
	}

	later(): void {
		this.back -= 1;
		this.changed();
	}

	setFrom(from: string): void {
		this.from = from;
		this.changed();
	}

	setTo(to: string): void {
		this.to = to;
		this.changed();
	}

	pull(): void {
		this.pulling = true;
		this.sourceError = null;
		this.dispatcher.dispatch("changed");
		pullBilling()
			.then((read) => this.setSources(read))
			.catch((caught: Error) => this.fail("sourceError", caught.message))
			.finally(() => {
				if (!this.disposed) {
					this.pulling = false;
					this.dispatcher.dispatch("changed");
				}
			});
	}

	changeCurrency(currency: string): void {
		if (this.changingCurrency) {
			return;
		}
		this.changingCurrency = true;
		this.dispatcher.dispatch("changed");
		setCurrency(currency)
			.then(
				(read) => this.setSources(read),
				(caught: Error) => this.fail("sourceError", caught.message),
			)
			.finally(() => {
				if (!this.disposed) {
					this.changingCurrency = false;
					this.dispatcher.dispatch("changed");
				}
			});
	}

	dispose(): void {
		this.disposed = true;
	}

	private setSources(read: BillingView): void {
		if (this.disposed) {
			return;
		}
		this.sources = read;
		this.changed();
	}

	private fail(field: "error" | "sourceError", message: string): void {
		if (!this.disposed) {
			this[field] = message;
			this.dispatcher.dispatch("changed");
		}
	}

	private spanNow(): { since: string; until: string } | null {
		if (this.range !== "custom") {
			return spanOf(this.range, Date.now(), this.back);
		}
		const since = Date.parse(this.from);
		const until = Date.parse(this.to);
		return Number.isNaN(since) || Number.isNaN(until) || until < since
			? null
			: {
					since: new Date(since).toISOString(),
					until: new Date(until + DAY).toISOString(),
				};
	}

	private changed(): void {
		this.span = this.spanNow();
		this.load();
		Object.assign(this.last, {
			range: this.range,
			back: this.back,
			report: this.report,
			sources: this.sources,
		});
		this.dispatcher.dispatch("changed");
	}

	/** Reads the report for the span, unless it already has, or is reading, that. */
	private load(): void {
		const { span } = this;
		if (span === null) {
			this.asked = null;
			return;
		}
		const key = [
			span.since,
			span.until,
			this.sources?.currency,
			this.sources?.pulledAt,
		].join("|");
		if (key === this.asked) {
			return;
		}
		this.asked = key;
		const read = ++this.reads;
		const current = () => !this.disposed && read === this.reads;
		spend(span.since, span.until).then(
			(report) => {
				if (current()) {
					this.report = report;
					this.error = null;
					this.changed();
				}
			},
			(caught: Error) => current() && this.fail("error", caught.message),
		);
	}
}
