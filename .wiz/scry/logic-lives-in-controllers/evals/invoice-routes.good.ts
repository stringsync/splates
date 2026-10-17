import Router from "@koa/router";
import type { InvoiceService } from "./invoice-service";

export function invoiceRoutes(invoices: InvoiceService): Router {
	const router = new Router();
	router.post("/invoices/:id/pay", async (ctx) => {
		await invoices.pay(ctx.params.id);
		ctx.status = 204;
	});
	return router;
}
