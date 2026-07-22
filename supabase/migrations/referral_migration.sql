create table if not exists kart_referrals (
	id uuid primary key default gen_random_uuid(),
	inviter_telegram_id text not null,
	invitee_telegram_id text not null unique,
	rewarded boolean not null default false,
	rewarded_at timestamptz,
	created_at timestamptz not null default now()
);

create index if not exists idx_kart_referrals_inviter on kart_referrals(inviter_telegram_id);
