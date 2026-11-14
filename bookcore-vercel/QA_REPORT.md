# BOOKCORE — негативное тестирование глазами пользователя

**Дата:** 14.11.2026 · **Автотесты:** 75/75 PASS (70 предыдущих сценариев + 5 новых регрессионных).

## Проверка в GitHub

- [75 тестов API и интерфейса](https://github.com/dftre4567392-source/Shablon1/actions/runs/43568497898)
- [Мобильный Chromium: штатные и негативные сценарии](https://github.com/dftre4567392-source/Shablon1/actions/runs/43568497886)

## Подтверждённые исправления

| Что делал пользователь | Что исправлено |
|---|---|
| Скрытые символы в имени | Имена без букв или с управляющими символами не сохраняются |
| Преждевременное завершение | Нельзя отметить будущую запись выполненной или неявкой |
| Смена статуса отменённой записи | Защищены недопустимые переходы состояния |
| Рабочие часы | Подтверждённое бронирование нельзя скрыть новым графиком |
| Нереальные даты блокировок | Блокировка ограничена периодом до 365 дней от сегодня |
| Устаревшие ответы календаря | Запоздавший ответ не заменяет часы новой выбранной даты |
| Закрытый диалог переноса | Ответы и ошибки после закрытия модального окна игнорируются |
| Некорректные ответы сервера | HTML 502 и технические API-коды отображаются понятным текстом |
| Ошибка загрузки списка записей | Пользователь видит сообщение о сбое, а не пустой экран без объяснения |

## 70 проверяемых сценариев

| № | Категория | Тест | Исходный файл |
|---:|---|---|---|
| 1 | Базовый | 01 GET /health reports isolated storage and Telegram enabled | `tests/api.integration.test.mjs` |
| 2 | Базовый | 02 unauthenticated and forged clients cannot access bookings/master | `tests/api.integration.test.mjs` |
| 3 | Базовый | 03 profile name rules and client role | `tests/api.integration.test.mjs` |
| 4 | Базовый | 04 invalid dates including 31 September, year 9999, past and >45 days | `tests/api.integration.test.mjs` |
| 5 | Базовый | 05 supported multi-service pricing and durations | `tests/api.integration.test.mjs` |
| 6 | Базовый | 06 single-service booking backward compatibility | `tests/api.integration.test.mjs` |
| 7 | Базовый | 07 duplicate/invalid service ids, unsupported bundles and malformed booking time | `tests/api.integration.test.mjs` |
| 8 | Базовый | 08 client cannot book before entering a name | `tests/api.integration.test.mjs` |
| 9 | Базовый | 09 overlapping booking is prevented for same client and other client | `tests/api.integration.test.mjs` |
| 10 | Базовый | 10 concurrent requests with stale Blob ETags cannot double-book | `tests/api.integration.test.mjs` |
| 11 | Базовый | 11 transient ETag conflict is retried without duplicate writes | `tests/api.integration.test.mjs` |
| 12 | Базовый | 12 appointments are private to their owner; master sees all | `tests/api.integration.test.mjs` |
| 13 | Базовый | 13 cancellation requires owner/master and reopens availability | `tests/api.integration.test.mjs` |
| 14 | Базовый | 14 reschedule preserves multi-service total and protects ownership | `tests/api.integration.test.mjs` |
| 15 | Базовый | 15 reschedule rejects invalid days and long-past year | `tests/api.integration.test.mjs` |
| 16 | Базовый | 16 master blocks full day, cannot block occupied day, then unblocks | `tests/api.integration.test.mjs` |
| 17 | Базовый | 17 partial day blocks affect time but not other intervals | `tests/api.integration.test.mjs` |
| 18 | Базовый | 18 master weekly schedule toggles access, client cannot edit | `tests/api.integration.test.mjs` |
| 19 | Базовый | 19 master edits services and validation rejects bad prices/duration | `tests/api.integration.test.mjs` |
| 20 | Базовый | 20 master manual booking and conflict with client booking | `tests/api.integration.test.mjs` |
| 21 | Базовый | 21 master sets completed and no-show; client forbidden | `tests/api.integration.test.mjs` |
| 22 | Базовый | 22 bot /start, /id and webhook secret guard | `tests/api.integration.test.mjs` |
| 23 | Базовый | 23 private avatar requires Telegram signature | `tests/api.integration.test.mjs` |
| 24 | Базовый | 24 late client cancellation/reschedule is blocked | `tests/api.integration.test.mjs` |
| 25 | Базовый | 25 studio timezone handles Barnaul, Moscow and Amsterdam correctly | `tests/api.integration.test.mjs` |
| 26 | Базовый | 26 original and additional masters both have access; both receive booking notice | `tests/api.integration.test.mjs` |
| 27 | Базовый | 27 malformed extra master IDs are never authorized | `tests/api.integration.test.mjs` |
| 28 | Базовый | 28 per-customer storage path defaults to previous production data path | `tests/api.integration.test.mjs` |
| 29 | Базовый | 29 custom customer deployment loads its own catalog, price and brand accent | `tests/api.integration.test.mjs` |
| 30 | Базовый | 30 invalid customer storage path is rejected before API startup | `tests/api.integration.test.mjs` |
| 31 | Базовый | 31 malformed or unsafe customer service catalog is rejected | `tests/api.integration.test.mjs` |
| 32 | Базовый | 32 invalid accent color reverts to BOOKCORE default | `tests/api.integration.test.mjs` |
| 33 | Базовый | 33 original default service catalog stays unchanged for the existing live studio | `tests/api.integration.test.mjs` |
| 34 | Базовый | UI-01 legacy native client date input no longer present | `tests/ui.unit.test.mjs` |
| 35 | Базовый | UI-02 month heading hides year; actual day values still keep it | `tests/ui.unit.test.mjs` |
| 36 | Базовый | UI-03 invalid day/year/leap-year rejected in browser | `tests/ui.unit.test.mjs` |
| 37 | Базовый | UI-04 year boundary December -> January without visible year | `tests/ui.unit.test.mjs` |
| 38 | Базовый | UI-05 multi-service selection and deselection preserves totals | `tests/ui.unit.test.mjs` |
| 39 | Базовый | UI-06 booking summary shows a localized day without year | `tests/ui.unit.test.mjs` |
| 40 | Базовый | UI-07 invalid date not applied by selectDate | `tests/ui.unit.test.mjs` |
| 41 | Базовый | UI-08 reschedule uses new calendar without native year input | `tests/ui.unit.test.mjs` |
| 42 | Базовый | UI-09 calendar layout has seven columns, disabled out-of-range days | `tests/ui.unit.test.mjs` |
| 43 | Базовый | UI-10 client and master navigation still render without errors | `tests/ui.unit.test.mjs` |
| 44 | Базовый | UI-11 selecting a day triggers combined service request | `tests/ui.unit.test.mjs` |
| 45 | Базовый | UI-12 booking disabled when bot is not configured | `tests/ui.unit.test.mjs` |
| 46 | Негативный | ABUSE-01 impossible, malformed and out-of-window dates cannot create bookings | `tests/adversarial.integration.test.mjs` |
| 47 | Негативный | ABUSE-02 malformed times and invalid service lists cannot book | `tests/adversarial.integration.test.mjs` |
| 48 | Негативный | ABUSE-03 repeated submit cannot create duplicate appointment | `tests/adversarial.integration.test.mjs` |
| 49 | Негативный | ABUSE-04 two competing clients get at most one confirmed slot | `tests/adversarial.integration.test.mjs` |
| 50 | Негативный | ABUSE-05 regular client cannot mutate master routes or another appointment | `tests/adversarial.integration.test.mjs` |
| 51 | Негативный | ABUSE-06 canceled booking cannot be reactivated by a client | `tests/adversarial.integration.test.mjs` |
| 52 | Негативный | ABUSE-07 malformed time blocks are rejected | `tests/adversarial.integration.test.mjs` |
| 53 | Негативный | ABUSE-08 invisible characters or emojis cannot become client names | `tests/adversarial.integration.test.mjs` |
| 54 | Негативный | ABUSE-09 legitimate multilingual customer names remain supported | `tests/adversarial.integration.test.mjs` |
| 55 | Негативный | ABUSE-10 master cannot prematurely complete or no-show future bookings | `tests/adversarial.integration.test.mjs` |
| 56 | Негативный | ABUSE-11 already cancelled records cannot be completed, no-showed or cancelled twice | `tests/adversarial.integration.test.mjs` |
| 57 | Негативный | ABUSE-12 changing weekly work hours cannot invalidate existing confirmed bookings | `tests/adversarial.integration.test.mjs` |
| 58 | Негативный | ABUSE-13 wrong content type does not cause unhandled API error | `tests/adversarial.integration.test.mjs` |
| 59 | Негативный | ABUSE-14 storm of concurrent requests never double-books one time | `tests/adversarial.integration.test.mjs` |
| 60 | Негативный | ABUSE-15 invalid 9999, past and one-year-plus master block dates cannot save | `tests/adversarial.integration.test.mjs` |
| 61 | Негативный | ABUSE-16 master cannot create invisible-name appointments | `tests/adversarial.integration.test.mjs` |
| 62 | Негативный | ABUSE-17 completed booking cannot be converted to no-show afterward | `tests/adversarial.integration.test.mjs` |
| 63 | Негативный | UI-ABUSE-01 closing reschedule before response never raises JavaScript error | `tests/adversarial.ui.test.mjs` |
| 64 | Негативный | UI-ABUSE-02 stale calendar response cannot replace newer free hours | `tests/adversarial.ui.test.mjs` |
| 65 | Негативный | UI-ABUSE-03 rejected late network response after modal close is harmless | `tests/adversarial.ui.test.mjs` |
| 66 | Негативный | UI-ABUSE-04 rapid triple click sends only one booking request | `tests/adversarial.ui.test.mjs` |
| 67 | Негативный | UI-ABUSE-05 malicious HTML from service title is escaped | `tests/adversarial.ui.test.mjs` |
| 68 | Негативный | UI-ABUSE-06 HTML error pages yield understandable message, not JSON parser error | `tests/adversarial.ui.test.mjs` |
| 69 | Негативный | UI-ABUSE-07 failed appointment loading displays a useful user message | `tests/adversarial.ui.test.mjs` |
| 70 | Негативный | UI-ABUSE-08 technical API codes are translated before showing to a client | `tests/adversarial.ui.test.mjs` |

## Браузерное тестирование

Настоящий Chromium на изолированном сервере: Telegram-онбординг, выбор двух услуг, календарь, запись, перенос, работа мастера, неверные имена, многократные нажатия, быстрое закрытие переноса, устаревшие ответы сети и ширина 320–768 пикселей. Ни одно обращение не изменяет рабочие клиентские записи.

## Дополнительные проверки и исправления (71–75)

| ID | Ошибка, которую проверяли | Результат |
|---|---|---|
| API-34 | После редактирования услуги перенос изменял длительность старой записи | Исправлено: сохраняется изначальная длительность и цена |
| API-35 | Отключение услуги блокировало перенос ранее созданной записи | Исправлено: используется сохранённый снимок длительности |
| API-36 | Несуществующие и неоднозначные местные часы в дни перевода часов | Исправлено: отклоняются, а не молча переносятся |
| API-37 | Запись начиналась корректно, но пересекала скачок часов до окончания процедуры | Исправлено: весь интервал проверяется на целостность |
| API-38 | Старые записи без поля `service_minutes` после редактирования услуг | Исправлено: длительность извлекается из ранее сохранённого интервала |

Тестовый стенд использует фиктивные данные и управляемое тестовое время для проверки переходов на летнее/зимнее время; рабочие записи не изменялись. В новой записи фиксируется `service_minutes`, старые записи продолжают работать без миграции базы. При изменении услуги её новые параметры действуют только на новые записи.

**Рабочий сайт:** [BOOKCORE Mini App](https://bookcore-telegram.vercel.app) — сборка Vercel READY, API и частное хранилище отвечают, старые настройки хранилища не менялись.

## Как воспроизвести

```bash
cd bookcore-vercel
npm run check
npm test
```

Chromium-тесты: `.github/workflows/bookcore-browser-e2e.yml` и `tests/browser.e2e.mjs`.

## Ограничения

Эти тесты существенно снижают риск случайных ошибок, но не гарантируют отсутствие всех багов. Не выполнены испытания на настоящих мобильных Telegram-клиентах Android/iOS, нагрузочный тест с реальным Vercel Blob и восстановление из резервной копии. В тестах используется искусственная подпись Telegram и in-memory хранилище; доставку реальных уведомлений надо подтвердить вручную. Законность и локализацию персональных данных необходимо отдельно проверить перед коммерческой эксплуатацией.
