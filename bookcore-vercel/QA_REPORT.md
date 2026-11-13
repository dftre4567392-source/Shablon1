# BOOKCORE — тестирование и критерии выпуска · 14.11.2026

**Результат последнего изолированного прогона:** 33 API-теста + 12 UI-тестов = **45/45 PASS**. Отдельный Chromium mobile E2E прошёл после исправления асинхронной перерисовки формы мастера.

Проверки: [45 тестов](https://github.com/dftre4567392-source/Shablon1/actions/runs/43473137888) · [Chromium E2E](https://github.com/dftre4567392-source/Shablon1/actions/runs/43473131754).

## API / бизнес-логика (33)

| ID | Сценарий |
|---|---|
| API-01 | GET /health reports isolated storage and Telegram enabled |
| API-02 | unauthenticated and forged clients cannot access bookings/master |
| API-03 | profile name rules and client role |
| API-04 | invalid dates including 31 September, year 9999, past and >45 days |
| API-05 | supported multi-service pricing and durations |
| API-06 | single-service booking backward compatibility |
| API-07 | duplicate/invalid service ids, unsupported bundles and malformed booking time |
| API-08 | client cannot book before entering a name |
| API-09 | overlapping booking is prevented for same client and other client |
| API-10 | concurrent requests with stale Blob ETags cannot double-book |
| API-11 | transient ETag conflict is retried without duplicate writes |
| API-12 | appointments are private to their owner; master sees all |
| API-13 | cancellation requires owner/master and reopens availability |
| API-14 | reschedule preserves multi-service total and protects ownership |
| API-15 | reschedule rejects invalid days and long-past year |
| API-16 | master blocks full day, cannot block occupied day, then unblocks |
| API-17 | partial day blocks affect time but not other intervals |
| API-18 | master weekly schedule toggles access, client cannot edit |
| API-19 | master edits services and validation rejects bad prices/duration |
| API-20 | master manual booking and conflict with client booking |
| API-21 | master sets completed and no-show; client forbidden |
| API-22 | bot /start, /id and webhook secret guard |
| API-23 | private avatar requires Telegram signature |
| API-24 | late client cancellation/reschedule is blocked |
| API-25 | studio timezone handles Barnaul, Moscow and Amsterdam correctly |
| API-26 | original and additional masters both have access; both receive booking notice |
| API-27 | malformed extra master IDs are never authorized |
| API-28 | per-customer storage path defaults to previous production data path |
| API-29 | custom customer deployment loads its own catalog, price and brand accent |
| API-30 | invalid customer storage path is rejected before API startup |
| API-31 | malformed or unsafe customer service catalog is rejected |
| API-32 | invalid accent color reverts to BOOKCORE default |
| API-33 | original default service catalog stays unchanged for the existing live studio |

## Клиентская часть / UI (12)

| ID | Сценарий |
|---|---|
| UI-01 | legacy native client date input no longer present |
| UI-02 | month heading hides year; actual day values still keep it |
| UI-03 | invalid day/year/leap-year rejected in browser |
| UI-04 | year boundary December -> January without visible year |
| UI-05 | multi-service selection and deselection preserves totals |
| UI-06 | booking summary shows a localized day without year |
| UI-07 | invalid date not applied by selectDate |
| UI-08 | reschedule uses new calendar without native year input |
| UI-09 | calendar layout has seven columns, disabled out-of-range days |
| UI-10 | client and master navigation still render without errors |
| UI-11 | selecting a day triggers combined service request |
| UI-12 | booking disabled when bot is not configured |

## Мобильный Chromium E2E

Последовательно проверяет: вход клиента, ввод имени, выбор двух услуг, свободную дату, запись, просмотр и перенос, защиту гостя, вход мастера, ручную запись и отсутствие горизонтального переполнения на ширине 390px. В тестах используется приватное in-memory-хранилище, реальные клиентские данные и боевые Telegram-токены не запрашиваются.

## Исправления этого выпуска

- Асинхронное обновление календаря больше не стирает данные, вводимые мастером.
- Конфигурация новых установок: BOOKCORE_STORAGE_PATH, BOOKCORE_SERVICES_JSON и TENANT_ACCENT_COLOR.
- Неверные каталог, цена, минуты и путь данных отклоняются.
- Старый путь хранилища действующей студии сохранён.
- Команды `npm run check` и `npm test` реально исполняются.

## Запуск тестов

```bash
cd bookcore-vercel
npm run check
npm test
```

## За пределами подтверждённого результата

- Настоящая доставка Telegram-сообщений не тестировалась по боевым аккаунтам в CI.
- Нагрузочные испытания и восстановление из резервной копии ещё не проводились.
- Текущий private Vercel Blob JSON не является транзакционной многоклиентской PostgreSQL.
- Правовые условия персональных данных необходимо проверить до коммерческого запуска.
- MAX и автоматические напоминания не реализованы.

## Приёмка каждого нового заказчика

Свой бот, отдельный проект, уникальный BOOKCORE_STORAGE_PATH, защищённые переменные окружения, тестовая запись/отмена/перенос, проверка мастера, уведомлений, часового пояса и договора.
