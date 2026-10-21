/** Where exchange rates come from: the European Central Bank's, by date. */
const RATES = "https://api.frankfurter.app";

/** An amount in the display currency, with what it was converted from. */
export interface Converted {
	dollars: number;
	original: {
		amount: number;
		currency: string;
		rate: number;
		rateDate: string;
	};
}

/**
 * Converts amounts to one display currency at the rate of the day each was
 * billed, fetched once per currency and day. Throws when a rate cannot be had,
 * so the caller can say so rather than show a wrong figure.
 */
export class Rates {
	private readonly known = new Map<
		string,
		Promise<{ rate: number; date: string }>
	>();

	constructor(
		readonly currency = "USD",
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async convert(amount: number, from: string, day: string): Promise<Converted> {
		const currency = from.toUpperCase();
		if (currency === this.currency) {
			return {
				dollars: amount,
				original: { amount, currency, rate: 1, rateDate: day },
			};
		}
		const key = `${currency}:${day}`;
		let found = this.known.get(key);
		if (found === undefined) {
			found = this.fetchRate(currency, day);
			this.known.set(key, found);
			found.catch(() => this.known.delete(key));
		}
		const { rate, date } = await found;
		return {
			dollars: amount * rate,
			original: { amount, currency, rate, rateDate: date },
		};
	}

	private async fetchRate(from: string, day: string) {
		const url = `${RATES}/${day}?from=${from}&to=${this.currency}`;
		const response = await this.fetcher(url);
		if (!response.ok) {
			throw new Error(
				`no ${from} to ${this.currency} rate for ${day}: ${response.status}`,
			);
		}
		const body = (await response.json()) as {
			date?: string;
			rates?: Record<string, number>;
		};
		const rate = body.rates?.[this.currency];
		if (typeof rate !== "number") {
			throw new Error(`no ${from} to ${this.currency} rate for ${day}`);
		}
		return { rate, date: body.date ?? day };
	}
}
