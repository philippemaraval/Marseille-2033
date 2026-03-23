import type { LayerConfig } from '../types/map'

export const seedLayers: LayerConfig[] = [
  {
    id: 'transport_metro',
    label: 'Transports > Metro (lignes)',
    category: 'transports en commun',
    features: [
      {
        id: 'seed-metro-1',
        name: 'Metro M1 (exemple)',
        status: 'existant',
        color: '#0055a4',
        geometry: 'line',
        positions: [
          [43.3436, 5.4301],
          [43.3101, 5.4022],
          [43.2974, 5.3814],
        ],
      },
    ],
  },
  {
    id: 'transport_tram',
    label: 'Transports > Tram (lignes)',
    category: 'transports en commun',
    features: [
      {
        id: 'seed-tram-1',
        name: 'Tram T2 (exemple)',
        status: 'existant',
        color: '#7c3aed',
        geometry: 'line',
        positions: [
          [43.3048, 5.3774],
          [43.2992, 5.3917],
          [43.2864, 5.4248],
        ],
      },
    ],
  },
  {
    id: 'transport_bhns',
    label: 'Transports > BHNS (lignes)',
    category: 'transports en commun',
    features: [
      {
        id: 'seed-bhns-1',
        name: 'BHNS (exemple)',
        status: 'propose',
        color: '#0f766e',
        geometry: 'line',
        positions: [
          [43.2853, 5.3794],
          [43.2667, 5.4252],
          [43.2323, 5.4425],
        ],
      },
    ],
  },
  {
    id: 'transport_ter',
    label: 'Transports > TER (lignes)',
    category: 'transports en commun',
    features: [
      {
        id: 'seed-ter-1',
        name: 'TER (exemple)',
        status: 'existant',
        color: '#334155',
        geometry: 'line',
        positions: [
          [43.3036, 5.3811],
          [43.2968, 5.4385],
          [43.291, 5.5129],
        ],
      },
    ],
  },
  {
    id: 'transport_stations',
    label: 'Transports > Stations (multi-modes)',
    category: 'transports en commun',
    features: [
      {
        id: 'seed-station-1',
        name: 'Saint-Charles (exemple)',
        status: 'existant',
        color: '#0f172a',
        geometry: 'point',
        position: [43.3036, 5.3811],
      },
    ],
  },
  {
    id: 'parks_polygons',
    label: 'Parcs > Surfaces',
    category: 'parcs',
    features: [
      {
        id: 'seed-park-poly-1',
        name: 'Parc Borely (exemple)',
        status: 'existant',
        color: '#166534',
        geometry: 'polygon',
        positions: [
          [43.2572, 5.3742],
          [43.2608, 5.3804],
          [43.2555, 5.3878],
          [43.2516, 5.3811],
        ],
      },
    ],
  },
  {
    id: 'parks_points',
    label: 'Parcs > Points',
    category: 'parcs',
    features: [
      {
        id: 'seed-park-point-1',
        name: 'Jardin des Vestiges (exemple)',
        status: 'existant',
        color: '#166534',
        geometry: 'point',
        position: [43.2987, 5.3743],
      },
    ],
  },
  {
    id: 'decoupage_quartiers',
    label: 'Decoupages > Quartiers',
    category: 'quartiers, arrondissements et secteurs',
    features: [
      {
        id: 'seed-quartier-poly-1',
        name: 'Quartier (exemple)',
        status: 'existant',
        color: '#be123c',
        geometry: 'polygon',
        positions: [
          [43.3008, 5.3635],
          [43.3044, 5.3669],
          [43.3026, 5.3725],
          [43.2986, 5.3692],
        ],
      },
      {
        id: 'seed-quartier-point-1',
        name: 'Centre quartier (exemple)',
        status: 'existant',
        color: '#be123c',
        geometry: 'point',
        position: [43.3023, 5.3675],
      },
    ],
  },
  {
    id: 'decoupage_arrondissements',
    label: 'Decoupages > Arrondissements',
    category: 'quartiers, arrondissements et secteurs',
    features: [
      {
        id: 'seed-arr-poly-1',
        name: '1er arrondissement (exemple)',
        status: 'existant',
        color: '#991b1b',
        geometry: 'polygon',
        positions: [
          [43.2928, 5.3623],
          [43.3048, 5.3649],
          [43.3042, 5.3865],
          [43.2911, 5.3839],
        ],
      },
    ],
  },
  {
    id: 'decoupage_secteurs',
    label: 'Decoupages > Secteurs',
    category: 'quartiers, arrondissements et secteurs',
    features: [
      {
        id: 'seed-secteur-poly-1',
        name: 'Secteur 1 (exemple)',
        status: 'existant',
        color: '#6b21a8',
        geometry: 'polygon',
        positions: [
          [43.2754, 5.3449],
          [43.3175, 5.3528],
          [43.3119, 5.4244],
          [43.2689, 5.4128],
        ],
      },
    ],
  },
]
