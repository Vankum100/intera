import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { FreshnessMark } from '../platform/freshness-mark';
import { WidgetHeader } from '../platform/widget-card';
import { widgetCardClass } from '../platform/widget-card-class';
import type { ICollectionDataResult, TWidgetSize } from '../platform/widget-types';
import type { IProviderPaymentQueueRow } from '../types/provider-payment-queue';
import {
  computePaymentPlan,
  type ICurrencyTotal,
  type IPaymentPlanResult,
  type IQueueBillItem,
} from './payment-planner-compute';
import {
  parsePaymentPlannerParams,
  type IPaymentPlannerConfig,
} from './payment-planner-params';
import './payment-planner.css';

const CLASS = 'dash-payment-planner';
const CHART_COLORS = [
  'var(--chart-blue)',
  'var(--chart-orange)',
  'var(--chart-aqua)',
  'var(--chart-yellow)',
  'var(--chart-violet)',
  'var(--chart-magenta)',
] as const;

export interface IPaymentPlannerWidgetProps {
  params?: Record<string, unknown>;
  data: ICollectionDataResult<IProviderPaymentQueueRow>;
  size?: TWidgetSize;
}

function formatAmount(value: number, config: IPaymentPlannerConfig): string {
  if (config.amountFormat === 'plain') return value.toFixed(2);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function currencyRemainderLabel(count: number): string {
  if (count === 1) return 'ещё 1 валюта';
  if (count >= 2 && count <= 4) return `ещё ${count} валюты`;
  return `ещё ${count} валют`;
}

function CurrencyTotals({
  totals,
  config,
  variant,
  expanded,
  onToggle,
  headingId,
}: {
  totals: ICurrencyTotal[];
  config: IPaymentPlannerConfig;
  variant: TWidgetSize;
  expanded: boolean;
  onToggle: () => void;
  headingId: string;
}): ReactElement {
  const limit = variant === 'quarter' ? 2 : undefined;
  const visible = limit && !expanded ? totals.slice(0, limit) : totals;
  const hiddenCount = totals.length - visible.length;

  return (
    <section className={`${CLASS}__currency-section`} aria-labelledby={headingId}>
      <h5 id={headingId} className={`${CLASS}__section-title`}>
        План по валютам
      </h5>
      <div className={`${CLASS}__currencies`}>
        {visible.map((total) => (
          <article className={`${CLASS}__currency`} key={total.currencyId}>
            <div className={`${CLASS}__currency-meta`}>
              <span>{total.currencyName}</span>
              <small>{total.billCount} сч. · {total.providerCount} пост.</small>
            </div>
            <strong>{formatAmount(total.totalAmount, config)}</strong>
          </article>
        ))}
        {totals.length === 0 ? (
          <p className={`${CLASS}__muted`}>В выбранных счетах нет валидных сумм.</p>
        ) : null}
      </div>
      {hiddenCount > 0 ? (
        <button
          className={`${CLASS}__more`}
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          + {currencyRemainderLabel(hiddenCount)}
          <span>Показать полный список</span>
        </button>
      ) : variant === 'quarter' && expanded && totals.length > 2 ? (
        <button className={`${CLASS}__more`} type="button" onClick={onToggle}>
          Свернуть список
        </button>
      ) : null}
    </section>
  );
}

function SelectionControl({
  value,
  maximum,
  onChange,
  variant,
  inputId,
}: {
  value: number;
  maximum: number;
  onChange: (value: number) => void;
  variant: TWidgetSize;
  inputId: string;
}): ReactElement {
  const compact = variant !== 'full';
  const clamp = (next: number) =>
    onChange(Math.min(maximum, Math.max(0, Number.isFinite(next) ? next : 0)));

  return (
    <section className={`${CLASS}__selection`} aria-labelledby={`${inputId}-label`}>
      <div className={`${CLASS}__selection-head`}>
        <span id={`${inputId}-label`}>Счетов к оплате</span>
        <output htmlFor={inputId} aria-live="polite">
          <strong>{value}</strong><span> из {maximum}</span>
        </output>
      </div>
      <div className={`${CLASS}__selection-controls`}>
        {!compact ? (
          <button type="button" onClick={() => clamp(value - 1)} disabled={value === 0} aria-label="Уменьшить количество счетов">−</button>
        ) : null}
        <input
          id={inputId}
          aria-labelledby={`${inputId}-label`}
          type="range"
          min={0}
          max={Math.max(0, maximum)}
          value={Math.min(value, maximum)}
          onChange={(event) => clamp(Number(event.target.value))}
        />
        {!compact ? (
          <>
            <input
              className={`${CLASS}__count-input`}
              type="number"
              min={0}
              max={maximum}
              value={value}
              aria-label="Точное количество счетов"
              onChange={(event) => clamp(Number(event.target.value))}
            />
            <button type="button" onClick={() => clamp(value + 1)} disabled={value >= maximum} aria-label="Увеличить количество счетов">+</button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ProviderBreakdown({
  plan,
  compact,
  headingId,
}: {
  plan: IPaymentPlanResult;
  compact: boolean;
  headingId: string;
}): ReactElement | null {
  if (plan.providerBreakdown.length === 0) return null;
  const currencies = Array.from(
    new Set(plan.providerBreakdown.map((item) => item.currencyName)),
  );

  return (
    <section className={`${CLASS}__breakdown ${compact ? `${CLASS}__breakdown--compact` : ''}`} aria-labelledby={headingId}>
      <div className={`${CLASS}__section-heading`}>
        <h5 id={headingId} className={`${CLASS}__section-title`}>Доли поставщиков</h5>
        <span>{plan.selectedProviderCount} в плане</span>
      </div>
      {currencies.map((currency) => {
        const items = plan.providerBreakdown.filter(
          (item) => item.currencyName === currency,
        );
        const accessibleSummary = items
          .map((item) => `${item.providerName}: ${item.sharePercent.toFixed(1)}%`)
          .join(', ');
        return (
          <div className={`${CLASS}__breakdown-group`} key={currency}>
            <span className={`${CLASS}__breakdown-code`}>{currency}</span>
            <div
              className={`${CLASS}__bar`}
              role="img"
              aria-label={`Распределение ${currency}: ${accessibleSummary}`}
            >
              {items.map((item, index) => (
                <span
                  aria-hidden="true"
                  key={item.providerId}
                  style={{
                    width: `${item.sharePercent}%`,
                    background: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
              ))}
            </div>
            {!compact ? (
              <div className={`${CLASS}__legend`}>
                {items.map((item, index) => (
                  <span key={item.providerId}>
                    <i aria-hidden="true" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                    {item.providerName} {item.sharePercent.toFixed(1)}%
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function CompactQueue({
  items,
  config,
  onClose,
  headingId,
}: {
  items: IQueueBillItem[];
  config: IPaymentPlannerConfig;
  onClose: () => void;
  headingId: string;
}): ReactElement {
  return (
    <section className={`${CLASS}__compact-queue`} aria-labelledby={headingId}>
      <div className={`${CLASS}__section-heading`}>
        <h5 id={headingId} className={`${CLASS}__section-title`}>Первые счета очереди</h5>
        <button type="button" onClick={onClose}>Закрыть</button>
      </div>
      <ol>
        {items.map((item) => (
          <li key={item.row.provider_bill_id} className={item.selected ? `${CLASS}__compact-bill--selected` : undefined}>
            <span className={`${CLASS}__position`}>{item.queuePosition}</span>
            <span><strong>{item.row.provider_bill_no}</strong><small>{item.row.provider_name}</small></span>
            <span className={item.hasInvalidAmount ? `${CLASS}__invalid-text` : undefined}>
              {item.hasInvalidAmount ? 'Некорректная сумма' : `${formatAmount(item.providerAmount ?? 0, config)} ${item.row.provider_currency_name}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FullQueue({
  plan,
  config,
  expandedBill,
  onToggleBill,
  headingId,
}: {
  plan: IPaymentPlanResult;
  config: IPaymentPlannerConfig;
  expandedBill: number | null;
  onToggleBill: (id: number) => void;
  headingId: string;
}): ReactElement {
  return (
    <section className={`${CLASS}__queue`} aria-labelledby={headingId}>
      <div className={`${CLASS}__section-heading`}>
        <h5 id={headingId} className={`${CLASS}__section-title`}>Очередь счетов</h5>
        <span>Показано {plan.visibleQueueItems.length} из {plan.totalQueueCount}</span>
      </div>
      <div className={`${CLASS}__table-wrap`}>
        <table className={`${CLASS}__table`}>
          <caption className={`${CLASS}__sr-only`}>Отфильтрованная и отсортированная очередь счетов поставщиков</caption>
          <thead><tr><th scope="col">№</th><th scope="col">Счёт / поставщик</th><th scope="col">Дата</th><th scope="col">Валюта</th><th scope="col">Сумма</th><th scope="col"><span className={`${CLASS}__sr-only`}>Детали</span></th></tr></thead>
          <tbody>
            {plan.visibleQueueItems.map((item) => {
              const open = expandedBill === item.row.provider_bill_id;
              const detailsId = `payment-details-${item.row.provider_bill_id}`;
              return (
                <Fragment key={item.row.provider_bill_id}>
                  <tr className={`${item.selected ? `${CLASS}__row--selected` : ''} ${item.hasInvalidAmount ? `${CLASS}__row--invalid` : ''}`}>
                    <td>{item.queuePosition}</td>
                    <td><strong>{item.row.provider_bill_no}</strong><small>{item.row.provider_name}</small></td>
                    <td>{item.row.provider_recv_date}</td>
                    <td>{item.row.provider_currency_name}</td>
                    <td>{item.hasInvalidAmount ? <span className={`${CLASS}__invalid-text`}>⚠ Некорректная сумма</span> : formatAmount(item.providerAmount ?? 0, config)}</td>
                    <td>
                      {config.showCustomerBills && item.hasCustomerBill ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          aria-label={`${open ? 'Скрыть' : 'Показать'} клиентский счёт для ${item.row.provider_bill_no}`}
                          onClick={() => onToggleBill(item.row.provider_bill_id)}
                        >{open ? '−' : '+'}</button>
                      ) : null}
                    </td>
                  </tr>
                  {open ? (
                    <tr id={detailsId} className={`${CLASS}__details`}>
                      <td colSpan={6}>
                        <strong>Клиентский счёт {item.row.customer_bill_no}</strong>
                        <span>{item.row.customer_name ?? 'Клиент не указан'} · {formatAmount(item.customerAmount ?? 0, config)} {item.row.provider_currency_name}</span>
                        {item.row.customer_comments ? <em>{item.row.customer_comments}</em> : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PaymentPlannerWidget({ params, data, size }: IPaymentPlannerWidgetProps): ReactElement {
  const config = useMemo(() => parsePaymentPlannerParams(params), [params]);
  const countInputId = useId();
  const filterHeadingId = `${countInputId}-filters`;
  const currencyHeadingId = `${countInputId}-currencies`;
  const providerHeadingId = `${countInputId}-providers`;
  const queueHeadingId = `${countInputId}-queue`;
  const effectiveSize = size ?? config.size;
  const [selectedCount, setSelectedCount] = useState(config.selectedCount);
  const [providerId, setProviderId] = useState<number | 'all'>(config.providerId);
  const [billingCycleId, setBillingCycleId] = useState<number | 'all'>(config.billingCycleId);
  const [currencyIds, setCurrencyIds] = useState(config.currencyIds);
  const [expandedBill, setExpandedBill] = useState<number | null>(null);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => setSelectedCount(config.selectedCount), [config.selectedCount]);
  useEffect(() => setProviderId(config.providerId), [config.providerId]);
  useEffect(() => setBillingCycleId(config.billingCycleId), [config.billingCycleId]);
  useEffect(() => setCurrencyIds(config.currencyIds), [config.currencyIds]);

  const runtimeConfig = useMemo(
    () => ({ ...config, providerId, billingCycleId, currencyIds }),
    [config, providerId, billingCycleId, currencyIds],
  );
  const plan = useMemo(
    () => computePaymentPlan(data.items, runtimeConfig, { selectedCountOverride: selectedCount }),
    [data.items, runtimeConfig, selectedCount],
  );
  const providers = useMemo(
    () => Array.from(new Map(data.items.map((row) => [row.provider_id, row.provider_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [data.items],
  );
  const cycles = useMemo(
    () => Array.from(new Map(data.items.map((row) => [row.billing_cycle_id, row.billing_cycle_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [data.items],
  );
  const currencies = useMemo(
    () => Array.from(new Map(data.items.map((row) => [row.provider_currency_id, row.provider_currency_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [data.items],
  );

  const toggleCurrency = (id: number) => {
    setCurrencyIds((current) => {
      if (current.length === 0) return [id];
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      return next.length === 0 || next.length === currencies.length ? [] : next;
    });
  };
  const resetFilters = () => {
    setProviderId('all');
    setBillingCycleId('all');
    setCurrencyIds([]);
  };
  const hasActiveFilters = providerId !== 'all' || billingCycleId !== 'all' || currencyIds.length > 0;

  const header = (
    <WidgetHeader
      title={config.description}
      subtitle={config.subtitle}
      aside={data.loaded ? (
        <FreshnessMark source="rows" stale={data.stale} lastSuccessAt={data.lastSuccessAt} showLabel={effectiveSize === 'full' || effectiveSize === 'half'} />
      ) : null}
    />
  );
  const articleClass = `${CLASS} ${widgetCardClass()}`;

  if (data.loading && !data.loaded) {
    return <article className={articleClass} data-size={effectiveSize}>{header}<div className={`${CLASS}__skeleton`} role="status"><span className={`${CLASS}__sr-only`}>Загрузка очереди платежей</span><i /><i /><i /></div></article>;
  }
  if (data.error && !data.loaded) {
    return <article className={articleClass} data-size={effectiveSize}>{header}<div className={`${CLASS}__state ${CLASS}__state--error`} role="alert"><strong>Не удалось загрузить очередь</strong><span>{data.error}</span></div></article>;
  }
  if (data.loaded && data.items.length === 0) {
    return <article className={articleClass} data-size={effectiveSize}>{header}<div className={`${CLASS}__state`}><strong>Очередь платежей пуста</strong><span>Новых счетов поставщиков нет.</span></div></article>;
  }

  return (
    <article className={articleClass} data-size={effectiveSize} aria-busy={data.loading}>
      {header}
      <div className={`${CLASS}__announcer`} aria-live="polite">
        {data.loading && data.loaded ? <span>Обновление данных…</span> : null}
      </div>

      {effectiveSize === 'full' ? (
        <section className={`${CLASS}__filter-panel`} aria-labelledby={filterHeadingId}>
          <div className={`${CLASS}__section-heading`}>
            <h5 id={filterHeadingId} className={`${CLASS}__section-title`}>Фильтры очереди</h5>
            {hasActiveFilters ? <button type="button" onClick={resetFilters}>Сбросить все</button> : <span>Все счета</span>}
          </div>
          <div className={`${CLASS}__filters`}>
            <label>Поставщик<select value={String(providerId)} onChange={(event) => setProviderId(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">Все поставщики</option>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Биллинговый цикл<select value={String(billingCycleId)} onChange={(event) => setBillingCycleId(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">Все циклы</option>{cycles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <fieldset>
              <legend>Валюты</legend>
              <div className={`${CLASS}__chips`}>
                <button type="button" aria-pressed={currencyIds.length === 0} onClick={() => setCurrencyIds([])}>Все</button>
                {currencies.map(([id, name]) => <button key={id} type="button" aria-pressed={currencyIds.includes(id)} onClick={() => toggleCurrency(id)}>{name}</button>)}
              </div>
            </fieldset>
          </div>
        </section>
      ) : null}

      <div className={`${CLASS}__overview`}>
        <SelectionControl value={plan.effectiveSelectedCount} maximum={plan.totalQueueCount} onChange={setSelectedCount} variant={effectiveSize} inputId={countInputId} />
        {effectiveSize === 'half' ? <div className={`${CLASS}__provider-count`}><strong>{plan.selectedProviderCount}</strong><span>поставщиков<br />в плане</span></div> : null}
      </div>

      {config.showSummary ? (
        <section className={`${CLASS}__summary`} aria-label="Сводка плана">
          {effectiveSize === 'full' ? <div className={`${CLASS}__stats`}><span><strong>{plan.totalQueueCount}</strong> в очереди</span><span><strong>{plan.effectiveSelectedCount}</strong> выбрано</span><span><strong>{plan.selectedProviderCount}</strong> поставщиков</span></div> : null}
          {plan.invalidSelectedCount > 0 ? <div className={`${CLASS}__warning`} role="status"><span aria-hidden="true">⚠</span> {plan.invalidSelectedCount} {plan.invalidSelectedCount === 1 ? 'счёт исключён' : 'счёта исключены'} из итогов из-за некорректной суммы</div> : null}
          <CurrencyTotals totals={plan.currencyTotals} config={config} variant={effectiveSize} expanded={showAllCurrencies} onToggle={() => setShowAllCurrencies((value) => !value)} headingId={currencyHeadingId} />
        </section>
      ) : null}

      {config.showProviderBreakdown && effectiveSize !== 'quarter' ? <ProviderBreakdown plan={plan} compact={effectiveSize === 'third'} headingId={providerHeadingId} /> : null}

      {effectiveSize === 'full' ? (
        <FullQueue plan={plan} config={config} expandedBill={expandedBill} onToggleBill={(id) => setExpandedBill((current) => current === id ? null : id)} headingId={queueHeadingId} />
      ) : (
        <>
          <button type="button" className={`${CLASS}__action`} aria-expanded={showQueue} onClick={() => setShowQueue((value) => !value)}>
            {showQueue ? 'Скрыть очередь' : effectiveSize === 'quarter' ? 'Открыть детали плана' : 'Открыть очередь платежей'} <span aria-hidden="true">→</span>
          </button>
          {showQueue ? <CompactQueue items={plan.visibleQueueItems} config={config} onClose={() => setShowQueue(false)} headingId={queueHeadingId} /> : null}
        </>
      )}
    </article>
  );
}
