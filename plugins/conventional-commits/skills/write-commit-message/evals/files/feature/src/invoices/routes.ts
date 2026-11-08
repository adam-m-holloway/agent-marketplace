import { Router } from 'express';
import { getInvoice, listInvoices } from './service';
import { renderInvoicePdf } from './pdf';

export const invoiceRoutes = Router();

invoiceRoutes.get('/invoices', async (req, res) => {
  res.json(await listInvoices(req.user.id));
});

invoiceRoutes.get('/invoices/:id', async (req, res) => {
  const invoice = await getInvoice(req.user.id, req.params.id);
  res.json(invoice);
});

invoiceRoutes.get('/invoices/:id/pdf', async (req, res) => {
  const invoice = await getInvoice(req.user.id, req.params.id);
  if (!invoice) return res.sendStatus(404);
  const pdf = await renderInvoicePdf(invoice);
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.number}.pdf"`);
  res.send(pdf);
});
