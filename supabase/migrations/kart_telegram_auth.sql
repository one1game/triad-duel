-- Triad Duel: переход на Telegram-авторизацию
-- Убираем FK на auth.users, добавляем telegram_id

-- Удаляем FK-связь с auth.users
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'kart_players'::regclass
    AND contype = 'f'
    AND confrelid = 'auth.users'::regclass;
  
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE kart_players DROP CONSTRAINT ' || fk_name;
  END IF;
END $$;

-- Добавляем telegram_id (уникальный ID пользователя Telegram)
ALTER TABLE kart_players ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;

-- Индекс для быстрого поиска по telegram_id
CREATE INDEX IF NOT EXISTS kart_players_telegram_idx ON kart_players(telegram_id);
