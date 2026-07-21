-- Миграция для добавления премиум-подписки
-- Применить для существующей БД: supabase db push / выполнить в SQL Editor
ALTER TABLE kart_players ADD COLUMN IF NOT EXISTS premium_until timestamptz;
