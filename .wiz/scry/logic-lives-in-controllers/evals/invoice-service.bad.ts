import type { Context } from "koa";
import type { Invoices } from "./invoices";

export class InvoiceService {
	constructor(private readonly invoices: Invoices) {}

	async pay(ctx: Context): Promise<void> {
		const invoice = await this.invoices.find(ctx.params.id);
		if (invoice === undefined) {
			ctx.throw(404, "no such invoice");
		}
		await this.invoices.markPaid(invoice.id);
		ctx.status = 204;
	}
}
