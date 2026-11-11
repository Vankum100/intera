import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import mockData from '../data/mock-payment-queue.json';
import type { ICollectionDataResult, TWidgetSize } from '../platform/widget-types';
import type { IProviderPaymentQueueRow } from '../types/provider-payment-queue';
import { PaymentPlannerWidget } from './payment-planner';

const rows = mockData as IProviderPaymentQueueRow[];

function data(
  overrides: Partial<ICollectionDataResult<IProviderPaymentQueueRow>> = {},
): ICollectionDataResult<IProviderPaymentQueueRow> {
  return {
    items: rows,
    loading: false,
    loaded: true,
    error: null,
    stale: false,
    lastSuccessAt: '2026-10-24T10:15:00Z',
    ...overrides,
  };
}

function render(size: TWidgetSize, result = data()): string {
  return renderToStaticMarkup(
    <PaymentPlannerWidget
      size={size}
      params={{ size, selectedCount: 14 }}
      data={result}
    />,
  );
}

describe('PaymentPlannerWidget responsive presentation', () => {
  it('renders the full controls, provider breakdown, and accessible queue table', () => {
    const html = render('full');
    expect(html).toContain('Фильтры очереди');
    expect(html).toContain('Доли поставщиков');
    expect(html).toContain('<caption');
    expect(html).toContain('Очередь счетов');
  });

  it('renders a half-size provider counter and full-queue action', () => {
    const html = render('half');
    expect(html).toContain('поставщиков');
    expect(html).toContain('Открыть очередь платежей');
    expect(html).not.toContain('<table');
  });

  it('renders third-size compact distribution without the full table', () => {
    const html = render('third');
    expect(html).toContain('dash-payment-planner__breakdown--compact');
    expect(html).toContain('role="img"');
    expect(html).not.toContain('<table');
  });

  it('renders an explicit currency remainder in quarter size', () => {
    const html = render('quarter');
    expect(html).toContain('ещё 2 валюты');
    expect(html).toContain('Показать полный список');
    expect(html).toContain('Открыть детали плана');
    expect(html).not.toContain('<table');
  });
});

describe('PaymentPlannerWidget data states', () => {
  it('renders an initial-loading skeleton instead of empty content', () => {
    const html = render('full', data({ items: [], loading: true, loaded: false }));
    expect(html).toContain('Загрузка очереди платежей');
    expect(html).not.toContain('Очередь платежей пуста');
  });

  it('keeps current content rendered during refresh', () => {
    const html = render('full', data({ loading: true, loaded: true }));
    expect(html).toContain('Обновление данных');
    expect(html).toContain('Очередь счетов');
    expect(html).toContain('aria-busy="true"');
  });

  it('renders stale, error, and empty states explicitly', () => {
    expect(render('half', data({ stale: true }))).toContain('Stale');
    expect(render('half', data({ items: [], loaded: false, error: 'Timeout' }))).toContain('Timeout');
    expect(render('half', data({ items: [] }))).toContain('Очередь платежей пуста');
  });
});
