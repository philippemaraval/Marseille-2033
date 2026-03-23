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
