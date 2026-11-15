-- Krillion Unlimited — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- The browser never talks to Supabase directly; only the Vercel API does,
-- using the service-role key. RLS is on with no policies, so the public
-- anon key can't read or write anything.

create table if not exists public.answers (
  prompt_id  text        not null,
  canonical  text        not null,           -- matching key (normalised)
  display    text        not null,           -- how it's shown to players
  count      integer     not null default 0,
  verdict    text,                           -- 'valid' | 'invalid' | null (unchecked)
  est_pct    real,                           -- AI's guess of how common it is (% of players)
  created_at timestamptz not null default now(),
  primary key (prompt_id, canonical)
);
create index if not exists answers_prompt_count_idx on public.answers (prompt_id, count desc);

create table if not exists public.prompt_totals (
  prompt_id text    primary key,
  total     integer not null default 0
);

create table if not exists public.score_buckets (
  bucket integer primary key,                -- floor(score / 10)
  count  integer not null default 0
);

create table if not exists public.suggestions (
  id         bigint generated always as identity primary key,
  text       text        not null,
  created_at timestamptz not null default now()
);

alter table public.answers       enable row level security;
alter table public.prompt_totals enable row level security;
alter table public.score_buckets enable row level security;
alter table public.suggestions   enable row level security;

-- Atomically count one answer. Returns the counts AFTER this answer.
create or replace function public.submit_answer(
  p_prompt text, p_canonical text, p_display text, p_verdict text, p_est real default null
) returns table (answer_count integer, prompt_total integer)
language plpgsql as $$
declare
  c integer;
  t integer;
begin
  insert into public.answers (prompt_id, canonical, display, count, verdict, est_pct)
  values (p_prompt, p_canonical, p_display, 1, p_verdict, p_est)
  on conflict (prompt_id, canonical) do update
    set count = public.answers.count + 1,
        verdict = coalesce(public.answers.verdict, excluded.verdict),
        est_pct = coalesce(public.answers.est_pct, excluded.est_pct)
  returning public.answers.count into c;

  insert into public.prompt_totals (prompt_id, total)
  values (p_prompt, 1)
  on conflict (prompt_id) do update set total = public.prompt_totals.total + 1
  returning public.prompt_totals.total into t;

  return query select c, t;
end;
$$;

create or replace function public.record_score(p_bucket integer)
returns void language sql as $$
  insert into public.score_buckets (bucket, count) values (p_bucket, 1)
  on conflict (bucket) do update set count = public.score_buckets.count + 1;
$$;

-- Only the server (service role) may call these.
revoke execute on function public.submit_answer(text, text, text, text, real) from public, anon, authenticated;
revoke execute on function public.record_score(integer) from public, anon, authenticated;
grant  execute on function public.submit_answer(text, text, text, text, real) to service_role;
grant  execute on function public.record_score(integer) to service_role;
