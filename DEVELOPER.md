# Provider Payment Planner — Developer Guide

## Purpose

This repository contains a read-only INTERA dashboard widget for planning provider payments from the Enigma `provider-payment-queue` data source. Users choose the first **N** invoices in the filtered queue and inspect totals by currency and provider.

The widget never writes data back to Enigma.

## Local development

Prerequisites:

- Node.js 20 or newer
- npm 10 or newer

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The app is fully self-contained: it uses [`src/data/mock-payment-queue.json`](./src/data/mock-payment-queue.json), so no INTERA or Enigma server is required.

Useful commands:

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

## Architecture

```text
untrusted widget params
  -> parsePaymentPlannerParams
  -> typed IPaymentPlannerConfig
  -> computePaymentPlan(rows, config, runtimeState)
  -> typed IPaymentPlanResult
  -> PaymentPlannerWidget
```

| Layer | Responsibility |
| --- | --- |
| `src/widget/payment-planner-params.ts` | Safely normalizes untrusted dashboard configuration. |
| `src/widget/payment-planner-compute.ts` | Contains deterministic domain logic without React or DOM dependencies. |
| `src/widget/payment-planner.tsx` | Presents the result, owns local interaction state, and handles data-envelope states. |
| `src/types/provider-payment-queue.ts` | Defines the typed Enigma DataSource contract used by mock data and the widget. |
| `src/sandbox/` | Provides a local interactive harness for all sizes, themes, parameters, and data states. |

## Enigma queue rules

The calculation order is intentionally fixed:

```text
filter by provider / billing cycle / currency
  -> stable sort by (payment_rank, provider_bill_id, input order)
  -> take the first selectedCount rows
  -> validate invoice amounts
  -> aggregate independently per currency
```

`payment_rank` is provider-partitioned in Enigma, so it is not globally unique. Invalid or missing ranks are placed after finite ranks. A provider amount is valid only when it is finite and strictly greater than zero; invalid invoices remain visible but are excluded from financial totals and provider shares.

Currencies are never converted or merged. A provider share is calculated only against the total of the same currency.

## Supported configuration

`PaymentPlannerWidget` accepts `params?: Record<string, unknown>`. Every property is optional and malformed values fall back safely.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `description` / `title` | string | `Provider Payment Planner` | `description` has priority. |
| `subtitle` | string | empty | Optional header subtitle. |
| `size` | `full \| half \| third \| quarter` | `full` | Maps to XL, L, M, and S dashboard slots. |
| `selectedCount` | number | `10` | Rounded and clamped to zero or more. |
| `currencyIds` | `number[]` | all | An empty array means every currency. |
| `providerId` | number / `all` | `all` | Provider filter. |
| `billingCycleId` | number / `all` | `all` | Billing-cycle filter. |
| `amountFormat` | `grouped \| plain` | `grouped` | Display formatting only. |
| `rowLimit` / `maxRows` | `10 \| 25 \| 50 \| 100` | `10` | Maximum visible queue rows. |
| `showCustomerBills` | boolean | `true` | Enables matched customer-bill details. |
| `showProviderBreakdown` | boolean | `true` | Enables provider share bars. |
| `showSummary` | boolean | `true` | Enables currency totals and headline summary. |

## Responsive behavior

| Widget slot | INTERA size | Content priority |
| --- | --- | --- |
| XL (4×2) | `full` | Filters, controls, totals, provider shares, and accessible queue table. |
| L (3×2) | `half` | Full currency totals, provider count, compact control, and detail action. |
| M (2×2) | `third` | Vertically scannable currency totals and compact provider bars. |
| S (1×2) | `quarter` | Selected count and up to two currency totals; remaining currencies always have an explicit disclosure control. |

## Data states and accessibility

The widget handles initial loading, background refresh, stale data, empty data, initial request failure, invalid provider amounts, and missing customer-bill data. A background refresh leaves the mounted content and local interaction state intact.

Interactive controls have labels and keyboard focus styles. Refresh messages use `aria-live`; disclosure controls use `aria-expanded` and `aria-controls`; provider bars include text alternatives; and heading IDs are unique when the sandbox renders multiple widgets at once.

## Verification

The test suite verifies:

- configuration fallback behavior;
- filter-before-slice ordering, stable sorting, and runtime selection;
- invalid amount categories and customer-bill rules;
- exact mock-data totals per currency and provider-share invariants;
- the responsive contract for every widget size;
- loading, refresh, stale, empty, and error presentation;
- required mock-data fields and basic type validity.

The provided task material referenced a YAML DataSource description, but no YAML attachment is present in this repository. The typed contract in [`src/types/provider-payment-queue.ts`](./src/types/provider-payment-queue.ts) is the executable source contract used for development and tests. Replace or reconcile it with the official YAML when that attachment is supplied.
