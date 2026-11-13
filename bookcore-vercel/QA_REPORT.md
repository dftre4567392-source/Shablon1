# BOOKCORE — отчёт о негативном тестировании · 14.11.2026

**Статус:** 68 / 68 автоматических проверок PASS. Два полноценных сценария в мобильном Chromium PASS: рабочий маршрут клиента/мастера и намеренно некорректные действия.

**Проверки в GitHub Actions:**
- [68 проверок API и пользовательского интерфейса](https://github.com/dftre4567392-source/Shablon1/actions/runs/43476409032)
- [Браузерное E2E с негативными действиями и скриншотами](https://github.com/dftre4567392-source/Shablon1/actions/runs/43476409224)

## Какие проблемы обнаружены и исправлены

| Область | Исправление |
|---|---|
| Некорректные имена | Не допускаются скрытые управляющие символы и строки без букв; нормальные имена на разных языках сохранены |
| Будущие записи | Мастер не может случайно отметить предстоящую процедуру выполненной/неявкой |
| История записей | Отменённая запись не может получить новый конфликтующий статус |
| Рабочий график | Нельзя сократить рабочие часы, скрыв уже подтверждённую будущую запись |
| Нереальные годы | Блокировки ограничены действительными датами от сегодня до 365 дней вперёд |
| Гонки при переносе | Запоздалые ответы по старой дате больше не меняют свободное время новой даты |
| Закрытие окна | Ответы после закрытия окна переноса безопасно игнорируются |
| Проблемы сервера | HTML-ошибка 502 показывается пользователю понятным сообщением вместо исключения JSON |

## Полный перечень сценариев — 68

| № | Тип | Название сценария | Исходный тест |
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

## Как проверить самостоятельно

```bash
cd bookcore-vercel
npm run check
npm test
```

Для браузерного Chromium — workflow `.github/workflows/bookcore-browser-e2e.yml`. Он запускает временный HTTP-сервер и тестовый Telegram/Blob, делает скриншоты смартфона 390px и тестирует адаптивность на 320–768px.

## Методика и ограничения

- Тесты не обращаются к живым записям реального мастера. Все POST-запросы выполняются к отдельному API в памяти, с фиктивной подписью Telegram и эмуляцией атомарного Vercel Blob.
- Проверены недействительные даты, года 9999/92920, неправильные имена, фальшивые роли и доступ к чужим записям, 12 конкурентных запросов на один слот, повторы, отмена, перенос, статус и график.
- Браузерное E2E выполняет реальные клики и проверку JavaScript-ошибок, узких экранов, неправильного имени, закрытия переноса во время загрузки и устаревших сетевых ответов.
- Автоматизация не гарантирует отсутствие всех дефектов. Тестирование не включает реальную доставку Telegram, нагрузочные испытания на боевом Blob, восстановление из резервной копии, различные версии Android/iOS или реальную эксплуатацию клиентом.
- Проект пока не является готовой многоклиентской SaaS-платформой. Для коммерческой эксплуатации отдельно проверить локализацию персональных данных, хранение, резервные копии и регламент обслуживания.

## Рекомендации для следующих релизов

Перед публикацией: `npm run check && npm test` и успешный Chromium E2E. При ошибке хотя бы одного теста — не публиковать. Для реальной приёмки после релиза провести одну тестовую запись через настоящие Telegram-аккаунты и вручную подтвердить уведомления.
