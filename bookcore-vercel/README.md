# BOOKCORE Telegram Mini App — Vercel

Самостоятельный деплой без Render и Railway.

### Архитектура
- `index.html`: клиентский интерфейс и кабинет мастера
- `api/handler.ts`: Node.js Vercel Function, проверка Telegram initData и операции бронирования
- Vercel Blob (private): JSON-хранилище с `ifMatch` (optimistic concurrency control), без публичного доступа к данным

### Настройка
`BLOB_READ_WRITE_TOKEN` — автоматически через подключение private Blob.
`TELEGRAM_BOT_TOKEN` — секрет бота, добавляется только в настройках Vercel.
`MASTER_TELEGRAM_ID` — Telegram ID мастера.
`TENANT_DISPLAY_NAME`, `MASTER_DISPLAY_NAME`, `TENANT_TIMEZONE` — настройки студии.
`APP_URL` — публичная HTTPS-ссылка Mini App.
`TELEGRAM_WEBHOOK_SECRET` — секрет для webhook, устанавливается сервером.

Настройка Telegram BotFather Main Mini App использует `APP_URL` напрямую; webhook бота `APP_URL/api/handler?route=%2Fbot%2Fwebhook`.

### Ограничения
Это компактная адаптация для одного мастера. Для высокого трафика, нескольких мастеров и долгосрочной эксплуатации рекомендуется заменить JSON Blob на транзакционную PostgreSQL.
Без встроенной оплаты, рекламы, обязательного телефона и паспортных полей.
