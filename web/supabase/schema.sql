create table if not exists public.map_features (
  id text primary key,
  name text not null,
  status text not null check (status in ('existant', 'en cours', 'propose')),
  category text not null,
  layer_id text not null,
  layer_label text not null,
  layer_sort_order integer not null default 0,
  color text not null default '#1d4ed8',
  style jsonb null,
  geometry_type text not null check (geometry_type in ('point', 'line', 'polygon')),
  coordinates jsonb not null,
  sort_order integer not null default 0,
  source text not null default 'manual',
  deleted_at timestamptz null,
  deleted_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.map_features
  add column if not exists layer_sort_order integer not null default 0;

alter table public.map_features
  add column if not exists deleted_at timestamptz null;

alter table public.map_features
  add column if not exists deleted_by uuid null;

alter table public.map_features
  add column if not exists style jsonb null;

create index if not exists idx_map_features_layer
  on public.map_features (layer_id, sort_order);

create index if not exists idx_map_features_category
  on public.map_features (category);

create index if not exists idx_map_features_source
  on public.map_features (source);

create index if not exists idx_map_features_deleted_at
  on public.map_features (deleted_at);

create index if not exists idx_map_features_category_layer_sort
  on public.map_features (category, layer_sort_order, layer_label);

create table if not exists public.map_layers (
  id text primary key,
  label text not null,
  category text not null,
  section_sort_order integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.map_layers
  add column if not exists section_sort_order integer not null default 0;

alter table public.map_layers
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_map_layers_category_order
  on public.map_layers (section_sort_order, category, sort_order, label);

create unique index if not exists idx_map_layers_category_label_lower
  on public.map_layers (category, lower(label));

do $$
declare
  has_non_zero_order boolean;
begin
  select exists (
    select 1
    from public.map_features
    where coalesce(layer_sort_order, 0) <> 0
  )
  into has_non_zero_order;

  if not has_non_zero_order then
    with ranked_layers as (
      select
        category,
        layer_id,
        row_number() over (
          partition by category
          order by min(layer_label), layer_id
        ) - 1 as computed_sort_order
      from public.map_features
      group by category, layer_id
    )
    update public.map_features as target
    set layer_sort_order = ranked_layers.computed_sort_order
    from ranked_layers
    where target.category = ranked_layers.category
      and target.layer_id = ranked_layers.layer_id;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'map_features'
  ) then
    with section_rank as (
      select
        category,
        dense_rank() over (
          order by min(coalesce(layer_sort_order, 0)), category
        ) - 1 as section_sort_order
      from public.map_features
      group by category
    ),
    ranked_layers as (
      select
        layer_id,
        layer_label,
        category,
        coalesce(layer_sort_order, 0) as sort_order,
        row_number() over (
          partition by layer_id
          order by coalesce(layer_sort_order, 0), category, layer_label
        ) as layer_rank
      from public.map_features
    )
    insert into public.map_layers (id, label, category, section_sort_order, sort_order)
    select
      ranked_layers.layer_id as id,
      ranked_layers.layer_label as label,
      ranked_layers.category,
      coalesce(section_rank.section_sort_order, 0) as section_sort_order,
      ranked_layers.sort_order
    from ranked_layers
    left join section_rank
      on section_rank.category = ranked_layers.category
    where ranked_layers.layer_rank = 1
    on conflict (id)
    do update set
      label = excluded.label,
      category = excluded.category,
      section_sort_order = excluded.section_sort_order,
      sort_order = excluded.sort_order;
  end if;
end;
$$;

create or replace function public.set_map_features_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create or replace function public.set_map_layers_updated_at()
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

drop trigger if exists trg_map_layers_updated_at on public.map_layers;
create trigger trg_map_layers_updated_at
before update on public.map_layers
for each row execute function public.set_map_layers_updated_at();

create or replace function public.ensure_map_layers_from_feature()
returns trigger
language plpgsql
as $$
declare
  normalized_category text;
  normalized_label text;
  resolved_sort integer;
  resolved_section_sort integer;
begin
  normalized_category := btrim(new.category);
  if normalized_category is null or normalized_category = '' then
    raise exception 'category cannot be empty';
  end if;

  normalized_label := btrim(new.layer_label);
  if normalized_label is null or normalized_label = '' then
    raise exception 'layer_label cannot be empty';
  end if;

  select section_sort_order
  into resolved_section_sort
  from public.map_layers
  where category = normalized_category
  order by section_sort_order asc, sort_order asc, label asc
  limit 1;

  if resolved_section_sort is null then
    select coalesce(max(section_sort_order), -1) + 1
    into resolved_section_sort
    from public.map_layers;
  end if;

  resolved_sort := coalesce(new.layer_sort_order, 0);

  if new.layer_sort_order is null then
    select coalesce(max(sort_order), -1) + 1
    into resolved_sort
    from public.map_layers
    where category = normalized_category;
  end if;

  insert into public.map_layers (id, label, category, section_sort_order, sort_order)
  values (
    new.layer_id,
    normalized_label,
    normalized_category,
    resolved_section_sort,
    resolved_sort
  )
  on conflict (id)
  do update set
    label = excluded.label,
    category = excluded.category,
    section_sort_order = excluded.section_sort_order,
    sort_order = excluded.sort_order;

  new.category := normalized_category;
  new.layer_label := normalized_label;
  new.layer_sort_order := resolved_sort;

  return new;
end;
$$;

drop trigger if exists trg_map_features_ensure_layers on public.map_features;
create trigger trg_map_features_ensure_layers
before insert or update on public.map_features
for each row execute function public.ensure_map_layers_from_feature();

alter table public.map_features enable row level security;
alter table public.map_layers enable row level security;

drop policy if exists "Public read map_features" on public.map_features;
create policy "Public read map_features"
on public.map_features
for select
using (deleted_at is null);

drop policy if exists "Authenticated write map_features" on public.map_features;
create policy "Authenticated write map_features"
on public.map_features
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Public read map_layers" on public.map_layers;
create policy "Public read map_layers"
on public.map_layers
for select
using (true);

drop policy if exists "Authenticated write map_layers" on public.map_layers;
create policy "Authenticated write map_layers"
on public.map_layers
for all
to authenticated
using (true)
with check (true);

create table if not exists public.map_feature_versions (
  version_id bigint generated by default as identity primary key,
  feature_id text not null,
  operation text not null check (
    operation in ('insert', 'update', 'trash', 'restore', 'delete')
  ),
  snapshot jsonb not null,
  actor_id uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_map_feature_versions_feature
  on public.map_feature_versions (feature_id, version_id desc);

create index if not exists idx_map_feature_versions_created_at
  on public.map_feature_versions (created_at desc);

create or replace function public.log_map_feature_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_operation text;
  payload jsonb;
  current_feature_id text;
begin
  if tg_op = 'INSERT' then
    current_operation := 'insert';
    payload := to_jsonb(new);
    current_feature_id := new.id;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      current_operation := 'trash';
    elsif old.deleted_at is not null and new.deleted_at is null then
      current_operation := 'restore';
    else
      current_operation := 'update';
    end if;
    payload := to_jsonb(new);
    current_feature_id := new.id;
  else
    current_operation := 'delete';
    payload := to_jsonb(old);
    current_feature_id := old.id;
  end if;

  insert into public.map_feature_versions (feature_id, operation, snapshot, actor_id)
  values (current_feature_id, current_operation, payload, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_map_features_versioning on public.map_features;
create trigger trg_map_features_versioning
after insert or update or delete on public.map_features
for each row execute function public.log_map_feature_version();

alter table public.map_feature_versions enable row level security;

drop policy if exists "Authenticated read map_feature_versions"
  on public.map_feature_versions;
create policy "Authenticated read map_feature_versions"
on public.map_feature_versions
for select
to authenticated
using (true);
