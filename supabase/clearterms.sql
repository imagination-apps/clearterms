-- =============================================================
-- ClearTerms — Supabase スキーマ
-- 既存のSupabaseプロジェクト(CSV Bridgeと相乗り)の SQL Editor で
-- このファイルを丸ごと実行してください。何度実行しても安全です。
-- テーブル・関数はすべて clearterms_ 接頭辞で、既存テーブルには触れません。
-- 契約書の本文はどのテーブルにも保存しません。
-- =============================================================

-- ---------- テーブル ----------

-- ライセンス(メール1件につきキー1つ。追加購入しても同じキー)
create table if not exists public.clearterms_licenses (
  license_key text primary key,
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- クレジットパック(購入1回=1行。期限はパックごと、延長しない)
create table if not exists public.clearterms_credit_packs (
  id                uuid primary key default gen_random_uuid(),
  license_key       text not null references public.clearterms_licenses(license_key) on delete cascade,
  email             text not null,
  credits_total     int  not null check (credits_total > 0),
  credits_remaining int  not null check (credits_remaining >= 0),
  purchased_at      timestamptz not null default now(),
  expires_at        timestamptz not null,
  stripe_session_id text not null unique,          -- Webhook二重処理防止
  reminder_sent_at  timestamptz,
  constraint clearterms_remaining_le_total check (credits_remaining <= credits_total)
);
create index if not exists clearterms_packs_key_idx
  on public.clearterms_credit_packs (license_key, expires_at);
create index if not exists clearterms_packs_expiry_idx
  on public.clearterms_credit_packs (expires_at) where reminder_sent_at is null;

-- 無料利用の記録(メールとIPハッシュのみ。本文は保存しない)
create table if not exists public.clearterms_free_usage (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  ip_hash    text not null,
  used_on    date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index if not exists clearterms_free_email_idx on public.clearterms_free_usage (email, used_on);
create index if not exists clearterms_free_ip_idx    on public.clearterms_free_usage (ip_hash, used_on);

-- メール確認コード(コードはハッシュで保存)
create table if not exists public.clearterms_email_codes (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int  not null default 0,
  last_sent_at timestamptz not null default now()
);

-- 確認コード送信ログ(同一IPからの大量送信防止)
create table if not exists public.clearterms_code_sends (
  id      bigserial primary key,
  ip_hash text not null,
  sent_at timestamptz not null default now()
);
create index if not exists clearterms_code_sends_idx on public.clearterms_code_sends (ip_hash, sent_at);

-- RLS: 有効化してポリシーは作らない = サーバー(service_role)以外は一切読み書き不可
alter table public.clearterms_licenses     enable row level security;
alter table public.clearterms_credit_packs enable row level security;
alter table public.clearterms_free_usage   enable row level security;
alter table public.clearterms_email_codes  enable row level security;
alter table public.clearterms_code_sends   enable row level security;

-- ---------- 関数(すべて原子的に処理) ----------

-- 確認コード送信の登録(クールダウン・IP上限をチェックしてから保存)
create or replace function public.clearterms_register_code_send(
  p_email text, p_ip_hash text, p_code_hash text,
  p_ttl_minutes int, p_cooldown_seconds int, p_ip_hourly_limit int
) returns text
language plpgsql as $$
declare
  v_last timestamptz;
  v_ip_count int;
begin
  perform pg_advisory_xact_lock(hashtext('clearterms_code:' || p_email));
  perform pg_advisory_xact_lock(hashtext('clearterms_codeip:' || p_ip_hash));

  select last_sent_at into v_last from public.clearterms_email_codes where email = p_email;
  if v_last is not null and v_last > now() - make_interval(secs => p_cooldown_seconds) then
    return 'cooldown';
  end if;

  select count(*) into v_ip_count from public.clearterms_code_sends
   where ip_hash = p_ip_hash and sent_at > now() - interval '1 hour';
  if v_ip_count >= p_ip_hourly_limit then
    return 'ip_limit';
  end if;

  insert into public.clearterms_email_codes (email, code_hash, expires_at, attempts, last_sent_at)
  values (p_email, p_code_hash, now() + make_interval(mins => p_ttl_minutes), 0, now())
  on conflict (email) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at,
        attempts = 0, last_sent_at = now();

  insert into public.clearterms_code_sends (ip_hash) values (p_ip_hash);
  delete from public.clearterms_code_sends where sent_at < now() - interval '1 day';
  return 'ok';
end $$;

-- 確認コードの照合('ok' | 'invalid' | 'expired' | 'too_many')
create or replace function public.clearterms_check_code(
  p_email text, p_code_hash text, p_max_attempts int
) returns text
language plpgsql as $$
declare
  r public.clearterms_email_codes%rowtype;
begin
  select * into r from public.clearterms_email_codes where email = p_email for update;
  if not found then return 'invalid'; end if;
  if r.expires_at < now() then return 'expired'; end if;
  if r.attempts >= p_max_attempts then return 'too_many'; end if;
  if r.code_hash <> p_code_hash then
    update public.clearterms_email_codes set attempts = attempts + 1 where email = p_email;
    return 'invalid';
  end if;
  delete from public.clearterms_email_codes where email = p_email;
  return 'ok';
end $$;

-- 無料枠の消費。メール・IPの両方が上限未満なら1件記録してIDを返す(超過時は null)
create or replace function public.clearterms_consume_free(
  p_email text, p_ip_hash text, p_limit int
) returns uuid
language plpgsql as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_email_count int;
  v_ip_count int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('clearterms_free_e:' || p_email));
  perform pg_advisory_xact_lock(hashtext('clearterms_free_i:' || p_ip_hash));

  select count(*) into v_email_count from public.clearterms_free_usage
   where email = p_email and used_on = v_today;
  select count(*) into v_ip_count from public.clearterms_free_usage
   where ip_hash = p_ip_hash and used_on = v_today;
  if v_email_count >= p_limit or v_ip_count >= p_limit then
    return null;
  end if;

  insert into public.clearterms_free_usage (email, ip_hash, used_on)
  values (p_email, p_ip_hash, v_today) returning id into v_id;
  return v_id;
end $$;

-- 無料枠の返却(API失敗時)
create or replace function public.clearterms_refund_free(p_id uuid) returns void
language sql as $$
  delete from public.clearterms_free_usage where id = p_id;
$$;

-- 無料枠の残り回数
create or replace function public.clearterms_free_remaining(
  p_email text, p_ip_hash text, p_limit int
) returns int
language sql stable as $$
  select greatest(0, p_limit - greatest(
    (select count(*) from public.clearterms_free_usage
      where email = p_email and used_on = (now() at time zone 'utc')::date),
    (select count(*) from public.clearterms_free_usage
      where ip_hash = p_ip_hash and used_on = (now() at time zone 'utc')::date)
  ))::int;
$$;

-- クレジットの消費。期限の近いパックから p_n 回分を差し引く。
-- 成功時: [{"id": パックID, "n": 消費数}, ...] / 残数不足: null
create or replace function public.clearterms_consume_credits(p_key text, p_n int)
returns jsonb
language plpgsql as $$
declare
  v_total int;
  v_need int := p_n;
  v_take int;
  v_alloc jsonb := '[]'::jsonb;
  r record;
begin
  if p_n < 1 then return null; end if;

  -- 対象パックをロック(並列リクエスト・連打でのすり抜け防止)
  perform 1 from public.clearterms_credit_packs
   where license_key = p_key and expires_at > now() and credits_remaining > 0
   for update;

  select coalesce(sum(credits_remaining), 0) into v_total
    from public.clearterms_credit_packs
   where license_key = p_key and expires_at > now() and credits_remaining > 0;
  if v_total < p_n then return null; end if;

  for r in
    select id, credits_remaining from public.clearterms_credit_packs
     where license_key = p_key and expires_at > now() and credits_remaining > 0
     order by expires_at asc
  loop
    exit when v_need = 0;
    v_take := least(v_need, r.credits_remaining);
    update public.clearterms_credit_packs
       set credits_remaining = credits_remaining - v_take
     where id = r.id;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('id', r.id, 'n', v_take));
    v_need := v_need - v_take;
  end loop;

  return v_alloc;
end $$;

-- クレジットの返却(API失敗時)。consume の戻り値をそのまま渡す
create or replace function public.clearterms_refund_credits(p_alloc jsonb) returns void
language plpgsql as $$
declare
  e jsonb;
begin
  for e in select * from jsonb_array_elements(p_alloc) loop
    update public.clearterms_credit_packs
       set credits_remaining = least(credits_total, credits_remaining + (e->>'n')::int)
     where id = (e->>'id')::uuid;
  end loop;
end $$;

-- 残り回数と期限の内訳
create or replace function public.clearterms_credit_status(p_key text)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'valid', exists(select 1 from public.clearterms_licenses where license_key = p_key),
    'email', (select email from public.clearterms_licenses where license_key = p_key),
    'total', coalesce((select sum(credits_remaining) from public.clearterms_credit_packs
                        where license_key = p_key and expires_at > now()), 0),
    'packs', coalesce((select jsonb_agg(jsonb_build_object(
                          'remaining', credits_remaining, 'expires_at', expires_at)
                          order by expires_at)
                        from public.clearterms_credit_packs
                        where license_key = p_key and expires_at > now() and credits_remaining > 0),
                      '[]'::jsonb)
  );
$$;

-- パックの追加(Stripe Webhookから)。同じsession IDは1回しか加算しない
create or replace function public.clearterms_add_pack(
  p_email text, p_session_id text, p_credits int, p_months int, p_new_key text
) returns table (license_key text, inserted boolean)
language plpgsql as $$
declare
  v_key text;
  v_id uuid;
begin
  if p_months > 6 then
    raise exception 'pack validity must not exceed 6 months';
  end if;

  insert into public.clearterms_licenses (license_key, email)
  values (p_new_key, p_email)
  on conflict (email) do nothing;

  select l.license_key into v_key from public.clearterms_licenses l where l.email = p_email;

  insert into public.clearterms_credit_packs
    (license_key, email, credits_total, credits_remaining, expires_at, stripe_session_id)
  values
    (v_key, p_email, p_credits, p_credits, now() + make_interval(months => p_months), p_session_id)
  on conflict (stripe_session_id) do nothing
  returning id into v_id;

  return query select v_key, (v_id is not null);
end $$;

-- 期限が近く残数のあるパック(リマインド用)。取得と同時に送信済みにする
create or replace function public.clearterms_claim_expiring_packs(p_days int)
returns table (email text, license_key text, credits_remaining int, expires_at timestamptz)
language sql as $$
  update public.clearterms_credit_packs p
     set reminder_sent_at = now()
   where p.reminder_sent_at is null
     and p.credits_remaining > 0
     and p.expires_at > now()
     and p.expires_at <= now() + make_interval(days => p_days)
  returning p.email, p.license_key, p.credits_remaining, p.expires_at;
$$;

-- キープアライブ用の軽いクエリ
create or replace function public.clearterms_ping() returns int
language sql stable as $$ select 1 $$;

-- 関数は service_role(サーバー)からのみ実行可能にする
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'clearterms\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
