create table if not exists kart_events (
	id bigint generated always as identity primary key,
	telegram_id text,
	event text not null,
	payload jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_kart_events_event_time on kart_events(event, created_at);
create index if not exists idx_kart_events_telegram on kart_events(telegram_id);
