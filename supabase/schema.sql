-- Mes Tournées — schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor > New query > Run.

create table if not exists public.chauffeurs (
  id        uuid primary key default gen_random_uuid(),
  nom       text not null,
  tel       text default '',
  cree_le   timestamptz not null default now()
);

create table if not exists public.tournees (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null default 'Nouvelle tournée',
  date          date not null default current_date,
  chauffeur_id  uuid references public.chauffeurs(id) on delete set null,
  statut        text not null default 'a_faire' check (statut in ('a_faire','en_cours','terminee')),
  -- Liste ordonnée des arrêts :
  -- [{id, client, adresse, tel, note, statut: a_faire|livre|probleme, heure, recu, motif, commentaire, photo}]
  arrets        jsonb not null default '[]'::jsonb,
  debut_le      timestamptz,
  fin_le        timestamptz,
  cree_le       timestamptz not null default now()
);

create index if not exists tournees_date_idx on public.tournees (date);
create index if not exists tournees_chauffeur_idx on public.tournees (chauffeur_id);

-- Sécurité : seules les personnes connectées lisent et modifient.
-- (Version 1 : tout utilisateur connecté a les mêmes droits. Les rôles
--  chauffeur / responsable distincts sont prévus pour la version 2.)
alter table public.chauffeurs enable row level security;
alter table public.tournees   enable row level security;

drop policy if exists "connectes_chauffeurs" on public.chauffeurs;
create policy "connectes_chauffeurs" on public.chauffeurs
  for all to authenticated using (true) with check (true);

drop policy if exists "connectes_tournees" on public.tournees;
create policy "connectes_tournees" on public.tournees
  for all to authenticated using (true) with check (true);

-- Temps réel : le responsable voit les livraisons arriver sans recharger.
do $$ begin
  begin alter publication supabase_realtime add table public.tournees;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chauffeurs; exception when duplicate_object then null; end;
end $$;

-- Photos de preuve de livraison (noms de fichiers aléatoires).
insert into storage.buckets (id, name, public)
values ('preuves', 'preuves', true)
on conflict (id) do nothing;

drop policy if exists "connectes_envoient_preuves" on storage.objects;
create policy "connectes_envoient_preuves" on storage.objects
  for insert to authenticated with check (bucket_id = 'preuves');
