import { describe, expect, it } from 'vitest';
import mockData from '../data/mock-payment-queue.json';
import type { IProviderPaymentQueueRow } from '../types/provider-payment-queue';
import { computePaymentPlan } from './payment-planner-compute';
import { parsePaymentPlannerParams } from './payment-planner-params';

const rows = mockData as IProviderPaymentQueueRow[];

describe('parsePaymentPlannerParams', () => {
  it('returns default config when params are undefined', () => {
    const config = parsePaymentPlannerParams(undefined);
    expect(config.description).toBe('Provider Payment Planner');
    expect(config.selectedCount).toBe(10);
    expect(config.rowLimit).toBe(10);
    expect(config.amountFormat).toBe('grouped');
    expect(config.currencyIds).toEqual([]);
  });

  it('clamps negative selectedCount to 0', () => {
    const config = parsePaymentPlannerParams({ selectedCount: -5 });
    expect(config.selectedCount).toBe(0);
  });

  it('deduplicates currencies and supports legacy maxRows', () => {
    const config = parsePaymentPlannerParams({
      currencyIds: [643, 840, 643, '978', null],
      maxRows: 25,
    });
    expect(config.currencyIds).toEqual([643, 840]);
    expect(config.rowLimit).toBe(25);
  });

  it('falls back safely for malformed params', () => {
    const config = parsePaymentPlannerParams({
      description: ' ',
      title: '  Queue  ',
      selectedCount: Number.NaN,
      size: 'huge',
      rowLimit: 12,
      showSummary: 'yes',
    });
    expect(config.description).toBe('Queue');
    expect(config.selectedCount).toBe(10);
    expect(config.size).toBe('full');
    expect(config.rowLimit).toBe(10);
    expect(config.showSummary).toBe(true);
  });
});

describe('computePaymentPlan', () => {
  it('sorts by payment_rank ASC then provider_bill_id ASC and selects first N', () => {
    const config = parsePaymentPlannerParams({ selectedCount: 6 });
    const plan = computePaymentPlan(rows, config);
    expect(plan.totalQueueCount).toBe(rows.length);
    expect(plan.effectiveSelectedCount).toBe(6);
    expect(
      plan.queueItems
        .slice(0, 6)
        .map((item) => item.row.provider_bill_id),
    ).toEqual([77602, 77604, 77606, 77608, 77610, 77612]);
  });

  it('flags invalid/missing amounts and excludes them from currency totals', () => {
    const config = parsePaymentPlannerParams({ selectedCount: 20 });
    const plan = computePaymentPlan(rows, config);
    // Bills 77630 (null) and 77638 (-1200) are within the first 20 rows
    expect(plan.invalidSelectedCount).toBe(2);
    const invalidBill = plan.queueItems.find(
      (item) => item.row.provider_bill_id === 77630,
    );
    expect(invalidBill?.hasInvalidAmount).toBe(true);
  });

  it('applies filters before slicing first N bills and clamps effectiveSelectedCount', () => {
    const config = parsePaymentPlannerParams({
      providerId: 1770, // Inmarsat Global Ltd (4 bills in mock data)
      selectedCount: 10,
    });
    const plan = computePaymentPlan(rows, config);
    expect(plan.totalQueueCount).toBe(4);
    expect(plan.effectiveSelectedCount).toBe(4);
  });

  it('applies currency and billing-cycle filters before selecting', () => {
    const plan = computePaymentPlan(
      rows,
      parsePaymentPlannerParams({
        billingCycleId: 20,
        currencyIds: [840],
        selectedCount: 100,
      }),
    );
    expect(plan.totalQueueCount).toBe(5);
    expect(plan.effectiveSelectedCount).toBe(5);
    expect(plan.queueItems.every((item) => item.row.billing_cycle_id === 20)).toBe(true);
    expect(plan.queueItems.every((item) => item.row.provider_currency_id === 840)).toBe(true);
  });

  it('keeps currencies separate and calculates provider shares within each currency', () => {
    const plan = computePaymentPlan(
      rows,
      parsePaymentPlannerParams({ selectedCount: rows.length }),
    );
    expect(plan.currencyTotals.map((total) => total.currencyName).sort()).toEqual([
      'EUR',
      'GBP',
      'RUB',
      'USD',
    ]);
    for (const currency of plan.currencyTotals) {
      const share = plan.providerBreakdown
        .filter((item) => item.currencyId === currency.currencyId)
        .reduce((sum, item) => sum + item.sharePercent, 0);
      expect(share).toBeCloseTo(100);
    }
    expect(
      Object.fromEntries(
        plan.currencyTotals.map((total) => [total.currencyName, total.totalAmount]),
      ),
    ).toEqual({ EUR: 40400, GBP: 24000, RUB: 2594500, USD: 195500 });
  });

  it('honors runtime selection and row display limits', () => {
    const plan = computePaymentPlan(
      rows,
      parsePaymentPlannerParams({ selectedCount: 1, rowLimit: 25 }),
      { selectedCountOverride: 7.6 },
    );
    expect(plan.effectiveSelectedCount).toBe(8);
    expect(plan.queueItems.filter((item) => item.selected)).toHaveLength(8);
    expect(plan.visibleQueueItems).toHaveLength(25);
  });

  it('detects linked customer bills and places invalid ranks last stably', () => {
    const customRows: IProviderPaymentQueueRow[] = [
      { ...rows[0], provider_bill_id: 9, payment_rank: null },
      { ...rows[0], provider_bill_id: 8, payment_rank: 'bad' },
      { ...rows[0], provider_bill_id: 7, payment_rank: 1 },
    ];
    const plan = computePaymentPlan(
      customRows,
      parsePaymentPlannerParams({ selectedCount: 3 }),
    );
    expect(plan.queueItems.map((item) => item.row.provider_bill_id)).toEqual([
      7, 8, 9,
    ]);
    expect(plan.queueItems[0].hasCustomerBill).toBe(true);
  });

  it('accepts numeric string ranks and preserves input order after equal tie-breakers', () => {
    const customRows: IProviderPaymentQueueRow[] = [
      { ...rows[0], provider_bill_no: 'first', provider_bill_id: 7, payment_rank: '2' },
      { ...rows[0], provider_bill_no: 'second', provider_bill_id: 7, payment_rank: 2 },
      { ...rows[0], provider_bill_no: 'earlier', provider_bill_id: 9, payment_rank: '1' },
    ];
    const plan = computePaymentPlan(customRows, parsePaymentPlannerParams({ selectedCount: 3 }));
    expect(plan.queueItems.map((item) => item.row.provider_bill_no)).toEqual([
      'earlier',
      'first',
      'second',
    ]);
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['blank', ''],
    ['non-numeric', 'not-a-number'],
  ])('keeps a %s amount in the queue but excludes it from aggregates', (_label, amount) => {
    const customRow = { ...rows[0], provider_total_due: amount };
    const plan = computePaymentPlan(
      [customRow],
      parsePaymentPlannerParams({ selectedCount: 1 }),
    );
    expect(plan.queueItems).toHaveLength(1);
    expect(plan.queueItems[0].selected).toBe(true);
    expect(plan.queueItems[0].hasInvalidAmount).toBe(true);
    expect(plan.invalidSelectedCount).toBe(1);
    expect(plan.currencyTotals).toEqual([]);
    expect(plan.providerBreakdown).toEqual([]);
  });

  it('requires both a non-empty customer number and finite customer amount', () => {
    const customRows: IProviderPaymentQueueRow[] = [
      { ...rows[0], provider_bill_id: 1, customer_bill_no: '  ', customer_total_due: 100 },
      { ...rows[0], provider_bill_id: 2, customer_bill_no: 'CB-2', customer_total_due: 'bad' },
      { ...rows[0], provider_bill_id: 3, customer_bill_no: 'CB-3', customer_total_due: 0 },
    ];
    const plan = computePaymentPlan(customRows, parsePaymentPlannerParams({ selectedCount: 3 }));
    expect(plan.queueItems.map((item) => item.hasCustomerBill)).toEqual([false, false, true]);
  });

  it('supports zero selection and clamps selection above queue length', () => {
    const zero = computePaymentPlan(rows, parsePaymentPlannerParams({ selectedCount: 0 }));
    const above = computePaymentPlan(rows.slice(0, 2), parsePaymentPlannerParams({ selectedCount: 99 }));
    expect(zero.effectiveSelectedCount).toBe(0);
    expect(zero.currencyTotals).toEqual([]);
    expect(above.effectiveSelectedCount).toBe(2);
  });
});
