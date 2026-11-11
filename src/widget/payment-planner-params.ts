import {
  WIDGET_ROW_LIMITS,
  WIDGET_SIZES,
  type TWidgetRowLimit,
  type TWidgetSize,
} from '../platform/widget-types';

export const AMOUNT_FORMATS = ['grouped', 'plain'] as const;
export type TAmountFormat = (typeof AMOUNT_FORMATS)[number];

export const DEFAULT_SELECTED_COUNT = 10;
export const DEFAULT_ROW_LIMIT: TWidgetRowLimit = 10;

export interface IPaymentPlannerConfig {
  /** Card header title (`params.description`, with fallback to `params.title` or `'Provider Payment Planner'`). */
  description: string;
  /** Optional card header subtitle (`params.subtitle`). */
  subtitle: string;
  /** Card width slot (`full` | `half` | `third` | `quarter`). */
  size: TWidgetSize;
  /** Number of top ranked invoices to include in the payment plan (`>= 0`, integer). Default: `10`. */
  selectedCount: number;
  /** Currency filter (`provider_currency_id[]`). Empty array means all currencies. */
  currencyIds: number[];
  /** Provider filter (`'all'` or a positive finite `provider_id`). Default: `'all'`. */
  providerId: number | 'all';
  /** Billing cycle filter (`'all'` or a finite `billing_cycle_id`). Default: `'all'`. */
  billingCycleId: number | 'all';
  /** Number formatting style (`'grouped'` with thousands separators or `'plain'`). Default: `'grouped'`. */
  amountFormat: TAmountFormat;
  /** Maximum rows displayed in the queue table (`10 | 25 | 50 | 100`, reads `rowLimit` or `maxRows`). Default: `10`. */
  rowLimit: TWidgetRowLimit;
  /** Whether to show matched customer bill information in row details. Default: `true`. */
  showCustomerBills: boolean;
  /** Whether to show per-provider breakdown. Default: `true`. */
  showProviderBreakdown: boolean;
  /** Whether to show top-level summary counters and currency totals. Default: `true`. */
  showSummary: boolean;
}

/**
 * Parses untyped widget `params` into a validated `IPaymentPlannerConfig` with all defaults applied.
 *
 * Rules:
 * 1. Never throw on malformed or missing fields — fall back to defaults.
 * 2. `description`: trimmed `params.description` or `params.title`, fallback `'Provider Payment Planner'`.
 * 3. `selectedCount`: non-negative integer (`Math.max(0, Math.round(n))`); if missing/invalid, fallback to `10`.
 * 4. `currencyIds`: unique finite numbers from `params.currencyIds`; empty array = all currencies.
 * 5. `rowLimit`: read `params.rowLimit` (or legacy `params.maxRows`); if not in `[10, 25, 50, 100]`, fallback to `10`.
 */
export function parsePaymentPlannerParams(
  params: Record<string, unknown> | undefined,
): IPaymentPlannerConfig {
  const p = params ?? {};

  const rawRowLimit = p.rowLimit ?? p.maxRows;

  return {
    description:
      typeof p.description === 'string' && p.description.trim()
        ? p.description.trim()
        : typeof p.title === 'string' && p.title.trim()
          ? p.title.trim()
          : 'Provider Payment Planner',
    subtitle: typeof p.subtitle === 'string' ? p.subtitle.trim() : '',
    size: WIDGET_SIZES.includes(p.size as TWidgetSize)
      ? (p.size as TWidgetSize)
      : 'full',
    selectedCount:
      typeof p.selectedCount === 'number' && Number.isFinite(p.selectedCount)
        ? Math.max(0, Math.round(p.selectedCount))
        : DEFAULT_SELECTED_COUNT,
    currencyIds: Array.isArray(p.currencyIds)
      ? Array.from(
          new Set(
            p.currencyIds.filter(
              (id): id is number =>
                typeof id === 'number' && Number.isFinite(id),
            ),
          ),
        )
      : [],
    providerId:
      typeof p.providerId === 'number' && Number.isFinite(p.providerId)
        ? p.providerId
        : 'all',
    billingCycleId:
      typeof p.billingCycleId === 'number' && Number.isFinite(p.billingCycleId)
        ? p.billingCycleId
        : 'all',
    amountFormat: AMOUNT_FORMATS.includes(p.amountFormat as TAmountFormat)
      ? (p.amountFormat as TAmountFormat)
      : 'grouped',
    rowLimit: WIDGET_ROW_LIMITS.includes(rawRowLimit as TWidgetRowLimit)
      ? (rawRowLimit as TWidgetRowLimit)
      : DEFAULT_ROW_LIMIT,
    showCustomerBills:
      typeof p.showCustomerBills === 'boolean' ? p.showCustomerBills : true,
    showProviderBreakdown:
      typeof p.showProviderBreakdown === 'boolean'
        ? p.showProviderBreakdown
        : true,
    showSummary: typeof p.showSummary === 'boolean' ? p.showSummary : true,
  };
}
