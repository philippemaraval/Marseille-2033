create table if not exists public.map_features (
  id text primary key,
  name text not null,
  status text not null check (status in ('existant', 'en cours', 'propose')),
  category text not null,
  layer_id text not null,
  layer_label text not null,
  color text not null default '#1d4ed8',
  geometry_type text not null check (geometry_type in ('point', 'line', 'polygon')),
  coordinates jsonb not null,
  sort_order integer not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_map_features_layer
  on public.map_features (layer_id, sort_order);

create index if not exists idx_map_features_category
  on public.map_features (category);

create index if not exists idx_map_features_source
  on public.map_features (source);

create or replace function public.set_map_features_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_map_features_updated_at on public.map_features;
create trigger trg_map_features_updated_at
before update on public.map_features
for each row execute function public.set_map_features_updated_at();

alter table public.map_features enable row level security;

drop policy if exists "Public read map_features" on public.map_features;
create policy "Public read map_features"
on public.map_features
for select
using (true);

drop policy if exists "Authenticated write map_features" on public.map_features;
create policy "Authenticated write map_features"
on public.map_features
for all
to authenticated
using (true)
with check (true);
