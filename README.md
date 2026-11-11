# Тестовое задание №2 — Provider Payment Planner Widget

Developer handoff in English: [DEVELOPER.md](./DEVELOPER.md).

**Проект:** INTERA Core  
**Стек:** React 19, TypeScript 5, Vite, Vitest

![Референс размеров и параметров](./reference-layout.svg)

---

## 1. Цель

Разработать интерактивный виджет планирования платежей поставщикам для дашборд-платформы **INTERA** на основе данных очереди счетов `provider-payment-queue` из интеграции **Enigma**.

Пользователь выбирает количество первых счетов в отфильтрованной очереди (`selectedCount`) и получает список предстоящих платежей с агрегированными суммами отдельно по каждой валюте и долями поставщиков внутри валюты. Виджет является аналитическим (read-only) и не изменяет данные в Enigma.

В архиве уже подготовлен стартовый проект с платформенными примитивами INTERA (`src/platform/`), эталонным набором данных (`src/data/mock-payment-queue.json` — 30 записей) и интерактивной песочницей (`src/sandbox/`). Ваша задача — реализовать три слоя виджета в `src/widget/`:

1. **`src/widget/payment-planner-params.ts`** — защитное чтение и нормализация `params: Record<string, unknown> | undefined` в `IPaymentPlannerConfig`.
2. **`src/widget/payment-planner-compute.ts`** — чистая функция расчёта `computePaymentPlan(rows, config, runtimeState)` без зависимостей от React и DOM.
3. **`src/widget/payment-planner.tsx` (+ `.css`)** — React-компонент `PaymentPlannerWidget`, адаптирующийся к четырём размерам карточки INTERA (`full`, `half`, `third`, `quarter`) и состояниям загрузки данных.

---

## 2. Быстрый старт

```bash
npm install
npm run dev        # запуск интерактивной песочницы
npm test           # запуск unit-тестов (Vitest)
npm run typecheck  # проверка типов TypeScript
```

---

## 3. Источник данных и доменные правила Enigma

Данные поступают из источника `provider-payment-queue` (`src/types/provider-payment-queue.ts`, фикстура `src/data/mock-payment-queue.json` — 30 записей в 4 валютах по 6 поставщикам).

### Ключевые поля `IProviderPaymentQueueRow`

- Очередь: `payment_rank`
- Поставщик: `provider_id`, `provider_code`, `provider_name`
- Счёт поставщика: `provider_bill_id`, `provider_bill_no`, `provider_bill_code`, `provider_recv_date`, `provider_total_due`
- Валюта счёта поставщика: `provider_currency_id`, `provider_currency_name` (`RUB`, `USD`, `EUR`, `GBP`)
- Биллинговый цикл: `billing_cycle_id`, `billing_cycle_name`
- Связанный клиентский счёт: `customer_id`, `customer_code`, `customer_name`, `customer_inn`, `customer_bill_id`, `customer_bill_no`, `customer_bill_code`, `customer_total_due`, `customer_comments`

### Доменные инварианты (обязательны к соблюдению)

1. **Фильтрация ДО отбора первых N счетов:**
   - В `Intera.Enigma.Api` фильтры по поставщику (`providerId`), биллинговому циклу (`billingCycleId`) и валютам (`currencyIds`) сужают очередь **до** отсечки первых `selectedCount` записей.
   - Если после применения фильтров в очереди осталось меньше записей, чем `selectedCount`, фактическое число выбранных счетов (`effectiveSelectedCount`) ограничивается длиной отфильтрованной очереди:
     `effectiveSelectedCount = Math.min(Math.max(0, selectedCount), filteredQueue.length)`.
2. **Сортировка и природа `payment_rank` в Enigma:**
   - В SQL-запросе `ProviderPaymentQueueController` ранг вычисляется оконной функцией:
     `ROW_NUMBER() OVER (PARTITION BY q.provider_id ORDER BY q.provider_recv_date, q.provider_bill_id)`.
   - Поскольку нумерация секционирована по `provider_id`, в общей очереди у каждого поставщика есть свой счёт с `payment_rank = 1`, `payment_rank = 2` и т.д.
   - Поэтому отфильтрованная очередь сортируется строго по правилу:
     1) `payment_rank` по возрастанию (валидные конечные числа идут первыми; строки с отсутствующим/некорректным рангом — в конце),
     2) при равенстве `payment_rank` — `provider_bill_id` по возрастанию,
     3) при оставшемся равенстве — исходный порядок следования в массиве.
   - Первые `effectiveSelectedCount` записей после сортировки получают `selected = true` (`queuePosition` от `1` до `effectiveSelectedCount`).
3. **Обработка некорректных сумм (`hasInvalidAmount`):**
   - Используйте `toFiniteNumber` из `src/platform/to-finite-number.ts`.
   - Счёт поставщика считается валидным только при `providerAmount !== null && providerAmount > 0`.
   - Если `provider_total_due` равен `null`, `0`, отрицательному числу (`-1200`) или нечисловой строке (`hasInvalidAmount = true`):
     - такая запись **остаётся в очереди** (и занимает позицию в `effectiveSelectedCount`, если попала в срез),
     - в интерфейсе таблицы она явно помечается предупреждением,
     - её сумма **исключается** из `currencyTotals` и `providerBreakdown` (запрещено молча считать её равной `0`), а счётчик `invalidSelectedCount` увеличивается.
4. **Расчёт сумм по валютам (`currencyTotals`):**
   - Суммы рассчитываются **строго отдельно по каждой валюте** (`provider_currency_id`, `provider_currency_name`) только по выбранным валидным счетам (`selected && !hasInvalidAmount`).
   - Складывать суммы разных валют между собой или конвертировать их запрещено.
5. **Расчёт по поставщикам (`providerBreakdown`):**
   - По выбранным валидным счетам рассчитываются:
     - `selectedProviderCount` — количество уникальных поставщиков среди выбранных валидных счетов;
     - для каждой пары `(provider_id, provider_currency_id)`: количество выбранных счетов (`billCount`), сумма платежей (`totalAmount`) и доля поставщика внутри соответствующей валюты (`sharePercent = (totalAmount / currencyTotalAmount) * 100`).
6. **Связанные клиентские счета (`hasCustomerBill`):**
   - Если у счёта указан непустой `customer_bill_no` и валидный `customer_total_due` (`toFiniteNumber(row.customer_total_due) !== null`), при `config.showCustomerBills === true` эти данные отображаются в таблице/деталях счёта.

---

## 4. Параметры виджета (`parsePaymentPlannerParams`)

| Параметр | Тип в `IPaymentPlannerConfig` | Значение по умолчанию | Правило валидации / fallback |
| --- | --- | --- | --- |
| `description` | `string` | `'Provider Payment Planner'` | Читает `params.description` или `params.title` (trim). |
| `subtitle` | `string` | `''` | Читает `params.subtitle` (trim). |
| `size` | `'full' \| 'half' \| 'third' \| 'quarter'` | `'full'` | При неизвестном значении — `'full'`. |
| `selectedCount` | `number` | `10` | Целое число `>= 0` (`Math.max(0, Math.round(n))`). При отсутствии/ошибке — `10`. |
| `currencyIds` | `number[]` | `[]` | Массив конечных чисел без дубликатов; пустой массив = все валюты. |
| `providerId` | `number \| 'all'` | `'all'` | Конечное число или `'all'`. |
| `billingCycleId` | `number \| 'all'` | `'all'` | Конечное число или `'all'`. |
| `amountFormat` | `'grouped' \| 'plain'` | `'grouped'` | `'grouped'` (с разделителями тысяч, например `1 248 500,00`) или `'plain'` (`1248500.00`). |
| `rowLimit` | `10 \| 25 \| 50 \| 100` | `10` | Читает `params.rowLimit` или `params.maxRows`. |
| `showCustomerBills` | `boolean` | `true` | Показывать связанные клиентские счета. |
| `showProviderBreakdown` | `boolean` | `true` | Показывать сводку и диаграмму по поставщикам. |
| `showSummary` | `boolean` | `true` | Показывать верхнюю сводку и итоги по валютам. |

---

## 5. Адаптация к четырём размерам INTERA

1. **`full` (XL — 4/4 ширины строки, ~880px):**
   - Общая статистика очереди (`totalQueueCount`, `effectiveSelectedCount`, `selectedProviderCount`, предупреждение при `invalidSelectedCount > 0`).
   - Интерактивный выбор количества счетов (slider + числовой ввод / кнопки `-` и `+`) и фильтры внутри виджета.
   - Сводка сумм по всем валютам выборки.
   - Распределение по поставщикам с переключением валюты (или группировкой по валютам), чтобы доли внутри валюты в сумме давали 100%.
   - Таблица очереди с выделением выбранных строк (`selected`), индикацией проблемных сумм (`hasInvalidAmount`) и просмотром деталей счёта (включая связанный клиентский счёт при `showCustomerBills = true`).
2. **`half` (L — 1/2 ширины строки, ~600px):**
   - Индикатор выбранных счетов (`effectiveSelectedCount из totalQueueCount`) и компактный слайдер.
   - Полная сводка сумм по валютам и количество поставщиков.
   - Действие открытия полной очереди платежей.
3. **`third` (M — 1/3 ширины строки, ~400px):**
   - Счётчик выбранных счетов относительно очереди (`14 / 30`).
   - Суммы по валютам и компактная полоса распределения по поставщикам.
   - Действие открытия деталей.
4. **`quarter` (S — 1/4 ширины строки, ~240px):**
   - Выбранное количество счетов.
   - Компактная финансовая сводка по валютам. **Важно:** если в компактной карточке помещаются только 1–2 валюты, а в плане их больше, обязательно отображать явный индикатор остатка (например, `+ ещё 2 валюты`) и действие раскрытия полного списка, **не скрывая валюты молча и не складывая их**.

### Требования к состояниям данных (`ICollectionDataResult`)

- **Начальная загрузка (`loading && !loaded`):** скелетон внутри карточки.
- **Фоновое обновление (`loading && loaded`):** **не размонтировать** виджет, сохраняя выбранное пользователем положение слайдера и открытые детали счёта.
- **Устаревшие данные (`stale === true`):** отображать `<FreshnessMark source="rows" stale={true} />` в шапке карточки.
- **Ошибка (`error !== null && !loaded`):** информативный блок ошибки.
- **Пустая очередь (`loaded && items.length === 0`):** корректное пустое состояние.

---

## 6. Критерии оценки

1. **Бизнес-логика и расчёты (30%):** соблюдение порядка «фильтрация → сортировка по `(payment_rank, provider_bill_id)` → срез первых N», корректный расчёт мультивалютных сумм и долей внутри валюты, исключение некорректных сумм из агрегатов.
2. **Архитектура и TypeScript (25%):** чистое разделение `params` / `compute` / `view`, отсутствие `any`, прохождение `npm run typecheck` и `npm test`.
3. **UI/UX и адаптация к 4 размерам INTERA (25%):** использование токенов темы INTERA (`src/platform/theme.css`), интерактивный слайдер, корректный индикатор дополнительных валют в компактном размере.
4. **Обработка граничных случаев и состояний данных (20%):** работа при `loading`, `refreshing`, `stale`, `empty`, `error`, некорректных суммах и отсутствии клиентского счёта.

---

## 7. Архитектура реализации

Реализация сохраняет однонаправленный поток данных и разделяет доверенные и недоверенные границы:

```text
params (unknown)
  → parsePaymentPlannerParams
  → IPaymentPlannerConfig
  → computePaymentPlan(rows, config, runtimeState)
  → IPaymentPlanResult
  → PaymentPlannerWidget
```

- **`payment-planner-params.ts`** — единственная граница для невалидированных параметров дашборда. Компонент и расчётный слой получают полную типизированную конфигурацию с применёнными fallback-значениями.
- **`payment-planner-compute.ts`** — чистая детерминированная функция без React и DOM. Она соблюдает порядок «фильтрация → стабильная сортировка → срез → агрегация» и никогда не объединяет разные валюты.
- **`payment-planner.tsx`** — отвечает только за runtime-состояние и представление. Фоновое обновление не заменяет дерево компонента, поэтому положение слайдера, фильтры и раскрытый счёт сохраняются.
- **Размеры карточки** имеют разную информационную иерархию: `full` показывает фильтры и таблицу, `half` — полные итоги и число поставщиков, `third` — вертикальные итоги и компактные доли, `quarter` — первые две валюты с обязательным раскрытием остатка.
- **Доступность** обеспечивается семантическими секциями и таблицей, подписями элементов управления, `aria-live` для обновлений, `aria-expanded` / `aria-controls` для раскрываемых данных, клавиатурным фокусом и текстовыми эквивалентами диаграмм.

### Проверка инвариантов

Тесты разделены на два уровня:

- расчётные тесты проверяют фильтрацию до среза, стабильную сортировку, все виды некорректных сумм, точные мультивалютные итоги, доли поставщиков и клиентские счета;
- серверный рендер проверяет контракт четырёх размеров и состояния `loading`, `refreshing`, `stale`, `empty`, `error` без привязки к браузеру.

> Примечание: текущий файл `mock-payment-queue.json` фактически содержит 32 строки, хотя исходное описание фикстуры указывает 30. Расчёт намеренно использует реальную длину входного массива и не содержит жёстко заданного количества строк.
