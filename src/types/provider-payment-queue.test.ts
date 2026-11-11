import { describe, expect, it } from 'vitest';
import mockData from '../data/mock-payment-queue.json';
import type { IProviderPaymentQueueRow } from './provider-payment-queue';

const rows = mockData as IProviderPaymentQueueRow[];

describe('provider-payment-queue mock data contract', () => {
  it('provides a locally usable non-empty queue with all supported currencies', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.provider_currency_name))).toEqual(
      new Set(['RUB', 'USD', 'EUR', 'GBP']),
    );
  });

  it('contains the mandatory provider invoice and filter fields on every row', () => {
    for (const row of rows) {
      expect(Number.isFinite(row.provider_id)).toBe(true);
      expect(row.provider_name.trim()).not.toBe('');
      expect(Number.isFinite(row.provider_bill_id)).toBe(true);
      expect(row.provider_bill_no.trim()).not.toBe('');
      expect(row.provider_recv_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(row.provider_currency_id)).toBe(true);
      expect(row.provider_currency_name).toMatch(/^[A-Z]{3}$/);
      expect(Number.isFinite(row.billing_cycle_id)).toBe(true);
      expect(row.billing_cycle_name.trim()).not.toBe('');
    }
  });

  it('uses nullable customer fields rather than omitting them', () => {
    for (const row of rows) {
      expect(Object.hasOwn(row, 'customer_bill_no')).toBe(true);
      expect(Object.hasOwn(row, 'customer_total_due')).toBe(true);
      expect(Object.hasOwn(row, 'customer_comments')).toBe(true);
    }
  });
});
