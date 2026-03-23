# Marseille 2033 - Web

Frontend React/TypeScript (Vite + Leaflet) avec import OSM reproductible et lecture Supabase.

## Demarrage local

```bash
npm install
npm run dev
```

## Import OSM (source initiale)

```bash
npm run import:osm
```

Fichiers generes:
- `src/data/layers.generated.ts`
- `data/osm-layers.json`

Variables utiles:
- `OSM_BBOX` (defaut: `43.02,4.95,43.62,5.86`)
- `OSM_MAX_FEATURES` (defaut: `300`)
- `OSM_MAX_LINE_POINTS` (defaut: `80`)
- `OSM_MAX_POLYGON_POINTS` (defaut: `60`)

## Supabase

1. Executer le schema SQL: `supabase/schema.sql`
   - Si la base existe deja: re-executer aussi le script pour ajouter les colonnes
     `deleted_at`, `deleted_by`, `layer_sort_order` et les triggers de versioning.
2. Configurer `.env` (voir `.env.example`)
3. Charger l'import OSM en base:

```bash
npm run push:osm:supabase
```

Variables requises pour le push:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Variables frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Si Supabase n'est pas configure ou vide, l'app bascule automatiquement sur les donnees locales importees.

## Mode admin (edition carte)

Le mode admin est cache derriere le bouton `Admin` dans le panneau lateral.

Pre-requis:
- Avoir execute `supabase/schema.sql` (RLS + policies actives).
- Avoir cree au moins un utilisateur dans `Authentication > Users` sur Supabase.

Fonctionnement:
- Connexion avec email + mot de passe Supabase.
- Session persistante cote navigateur (reconnexion automatique).
- `Creation`: clic sur la carte pour poser un point, une ligne ou un polygone.
- `Edition`: clic sur un element visible pour modifier metadonnees/couleur/geometrie.
- `Suppression`: envoi dans la corbeille (soft delete), restauration possible.
- `Versioning`: historique des versions par element + restauration de la version precedente.
- `Ordre manuel`: fleches haut/bas sur les calques (ordre par categorie, persiste en base).
- `Exports`: GeoJSON / KML des elements visibles.
- `Imports`: GeoJSON / KML depuis l'admin vers un calque cible.
- `Debug`: bloc diagnostic Supabase repliable dans le panneau admin.

Toutes les modifications sont ecrites dans `map_features` puis rechargees immediatement.

## Build

```bash
npm run build
npm run lint
```

## Cloudflare Pages

- Branch: `main`
- Root directory: `web`
- Build command: `npm run build`
- Build output directory: `dist`
