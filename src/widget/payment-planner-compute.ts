import type { IProviderPaymentQueueRow } from '../types/provider-payment-queue';
import { toFiniteNumber } from '../platform/to-finite-number';
import type { IPaymentPlannerConfig } from './payment-planner-params';

/** Processed invoice row in the sorted queue. */
export interface IQueueBillItem {
  /** 1-based position in the filtered & sorted queue. */
  queuePosition: number;
  row: IProviderPaymentQueueRow;
  /** Numeric `payment_rank` (`null` if missing/invalid). */
  rank: number | null;
  /** Numeric `provider_total_due` (`null` if missing or `<= 0`). */
  providerAmount: number | null;
  /** `true` when `provider_total_due` is `null`, `<= 0`, or non-numeric. */
  hasInvalidAmount: boolean;
  /** `true` when `queuePosition <= effectiveSelectedCount`. */
  selected: boolean;
  /** Numeric `customer_total_due` (`null` if absent or non-numeric). */
  customerAmount: number | null;
  /** `true` when both `customer_bill_no` (non-empty) and a valid `customerAmount` are present. */
  hasCustomerBill: boolean;
}

/** Aggregated payment sum for a single currency across selected valid bills. */
export interface ICurrencyTotal {
  currencyId: number;
  currencyName: string;
  /** Total amount of selected valid bills in this currency. */
  totalAmount: number;
  /** Number of selected valid bills in this currency. */
  billCount: number;
  /** Number of unique providers in this currency among selected valid bills. */
  providerCount: number;
}

/** Per-provider payment share within a specific currency across selected valid bills. */
export interface IProviderCurrencyBreakdownItem {
  providerId: number;
  providerName: string;
  currencyId: number;
  currencyName: string;
  billCount: number;
  totalAmount: number;
  /** Share (`0..100`) of this provider's `totalAmount` within `currencyTotal.totalAmount`. */
  sharePercent: number;
}

/** Interactive UI overrides inside the widget (slider override, quick filter overrides). */
export interface IPaymentPlannerRuntimeState {
  selectedCountOverride?: number;
}

export interface IPaymentPlanResult {
  /** Total bills in the filtered queue. */
  totalQueueCount: number;
  /** Clamped number of selected bills: `Math.min(Math.max(0, selectedCount), totalQueueCount)`. */
  effectiveSelectedCount: number;
  /** Number of unique providers across ALL selected bills (including or excluding invalid, specify: valid selected bills). */
  selectedProviderCount: number;
  /** Count of selected bills that have `hasInvalidAmount === true` (excluded from sums). */
  invalidSelectedCount: number;
  /** Totals per currency for selected valid bills (never summing across currencies). */
  currencyTotals: ICurrencyTotal[];
  /** Provider breakdown per currency for selected valid bills, sorted by `totalAmount` descending. */
  providerBreakdown: IProviderCurrencyBreakdownItem[];
  /** Full filtered and sorted queue. */
  queueItems: IQueueBillItem[];
  /** Queue sliced to `config.rowLimit` for table display. */
  visibleQueueItems: IQueueBillItem[];
}

/**
 * Pure computation of the provider payment plan from `provider-payment-queue` rows.
 *
 * Must NOT depend on React or DOM APIs.
 *
 * Key domain rules:
 * 1. Scope filters (`providerId`, `billingCycleId`, `currencyIds`) are applied BEFORE sorting and selecting
 *    the first `selectedCount` bills.
 * 2. Sorting order:
 *    - `payment_rank` ascending (valid finite ranks first; missing/invalid ranks last),
 *    - `provider_bill_id` ascending as tie-breaker (since Enigma partitions `payment_rank` by `provider_id`),
 *    - original array index (stable order).
 * 3. Selection: `effectiveSelectedCount = Math.min(Math.max(0, selectedCount), filteredQueue.length)`.
 *    The first `effectiveSelectedCount` items in the sorted queue have `selected = true`.
 * 4. Invalid amounts: if `toFiniteNumber(row.provider_total_due)` is `null` or `<= 0`, mark
 *    `hasInvalidAmount = true`. Never treat invalid amounts as `0` in aggregates — exclude them from
 *    `currencyTotals` and `providerBreakdown` and increment `invalidSelectedCount` when selected.
 * 5. Never sum amounts across different currencies.
 */
export function computePaymentPlan(
  rows: readonly IProviderPaymentQueueRow[],
  config: IPaymentPlannerConfig,
  runtimeState?: IPaymentPlannerRuntimeState,
): IPaymentPlanResult {
  const selectedCountValue = runtimeState?.selectedCountOverride;
  const selectedCount =
    typeof selectedCountValue === 'number' && Number.isFinite(selectedCountValue)
      ? Math.max(0, Math.round(selectedCountValue))
      : config.selectedCount;
  const currencyFilter = new Set(config.currencyIds);

  const filtered = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (config.providerId !== 'all' && row.provider_id !== config.providerId) {
        return false;
      }
      if (
        config.billingCycleId !== 'all' &&
        row.billing_cycle_id !== config.billingCycleId
      ) {
        return false;
      }
      return currencyFilter.size === 0 || currencyFilter.has(row.provider_currency_id);
    })
    .sort((left, right) => {
      const leftRank = toFiniteNumber(left.row.payment_rank);
      const rightRank = toFiniteNumber(right.row.payment_rank);
      if (leftRank === null && rightRank !== null) return 1;
      if (leftRank !== null && rightRank === null) return -1;
      if (leftRank !== null && rightRank !== null && leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const billDifference =
        left.row.provider_bill_id - right.row.provider_bill_id;
      return billDifference || left.originalIndex - right.originalIndex;
    });

  const effectiveSelectedCount = Math.min(selectedCount, filtered.length);
  const queueItems: IQueueBillItem[] = filtered.map(({ row }, index) => {
    const rawProviderAmount = toFiniteNumber(row.provider_total_due);
    const providerAmount =
      rawProviderAmount !== null && rawProviderAmount > 0
        ? rawProviderAmount
        : null;
    const customerAmount = toFiniteNumber(row.customer_total_due);
    return {
      queuePosition: index + 1,
      row,
      rank: toFiniteNumber(row.payment_rank),
      providerAmount,
      hasInvalidAmount: providerAmount === null,
      selected: index < effectiveSelectedCount,
      customerAmount,
      hasCustomerBill:
        typeof row.customer_bill_no === 'string' &&
        row.customer_bill_no.trim().length > 0 &&
        customerAmount !== null,
    };
  });

  const selectedValid = queueItems.filter(
    (item) => item.selected && !item.hasInvalidAmount,
  );
  const currencyMap = new Map<
    number,
    { currencyName: string; totalAmount: number; billCount: number; providers: Set<number> }
  >();
  const providerMap = new Map<
    string,
    Omit<IProviderCurrencyBreakdownItem, 'sharePercent'>
  >();

  for (const item of selectedValid) {
    const { row, providerAmount } = item;
    if (providerAmount === null) continue;
    const currency = currencyMap.get(row.provider_currency_id) ?? {
      currencyName: row.provider_currency_name,
      totalAmount: 0,
      billCount: 0,
      providers: new Set<number>(),
    };
    currency.totalAmount += providerAmount;
    currency.billCount += 1;
    currency.providers.add(row.provider_id);
    currencyMap.set(row.provider_currency_id, currency);

    const key = `${row.provider_id}:${row.provider_currency_id}`;
    const provider = providerMap.get(key) ?? {
      providerId: row.provider_id,
      providerName: row.provider_name,
      currencyId: row.provider_currency_id,
      currencyName: row.provider_currency_name,
      billCount: 0,
      totalAmount: 0,
    };
    provider.billCount += 1;
    provider.totalAmount += providerAmount;
    providerMap.set(key, provider);
  }

  const currencyTotals: ICurrencyTotal[] = Array.from(currencyMap.entries())
    .map(([currencyId, value]) => ({
      currencyId,
      currencyName: value.currencyName,
      totalAmount: value.totalAmount,
      billCount: value.billCount,
      providerCount: value.providers.size,
    }))
    .sort((a, b) => a.currencyName.localeCompare(b.currencyName));

  const providerBreakdown: IProviderCurrencyBreakdownItem[] = Array.from(
    providerMap.values(),
  )
    .map((value) => ({
      ...value,
      sharePercent:
        (value.totalAmount /
          (currencyMap.get(value.currencyId)?.totalAmount ?? value.totalAmount)) *
        100,
    }))
    .sort(
      (a, b) =>
        a.currencyName.localeCompare(b.currencyName) ||
        b.totalAmount - a.totalAmount ||
        a.providerName.localeCompare(b.providerName),
    );

  return {
    totalQueueCount: queueItems.length,
    effectiveSelectedCount,
    selectedProviderCount: new Set(
      selectedValid.map((item) => item.row.provider_id),
    ).size,
    invalidSelectedCount: queueItems.filter(
      (item) => item.selected && item.hasInvalidAmount,
    ).length,
    currencyTotals,
    providerBreakdown,
    queueItems,
    visibleQueueItems: queueItems.slice(0, config.rowLimit),
  };
}
