const formatters = new Map<string, Intl.NumberFormat>();

export function formatCurrency(cents: number, currency: string, locale = "en-US"): string {
	const key = `${locale}:${currency}`;
	let formatter = formatters.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
		formatters.set(key, formatter);
	}
	return formatter.format(cents / 100);
}

export function sumCents(amounts: number[]): number {
	return amounts.reduce((total, amount) => total + amount, 0);
}
