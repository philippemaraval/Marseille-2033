# Marseille2033 - Synthese du questionnaire (Q1-Q94)

Date: 2026-03-23  
Statut: questionnaire arrete a ta demande a Q95/100 ("Arretons-nous la").

## Decisions cles
- Produit: site public en lecture, avec un seul admin en edition.
- Carte: Leaflet, fond OSM par defaut, 5 fonds V1, aucun calque actif au chargement, zone limitee a la metropole.
- Donnees: import initial OSM via script reproductible, stockage PostGIS (Supabase), edition directe sur carte.
- Structure V1: transports en commun, parcs, quartiers/arrondissements/secteurs.
- Workflow: publication immediate, versioning + restauration, corbeille sans purge auto.
- Stack: React + TypeScript + Vite, frontend direct Supabase, deploy auto GitHub `main` -> Cloudflare Pages.
- UX: style minimaliste, theme clair unique, panneau lateral, filtres statut/categorie, legende dynamique.
- Livraison: priorite a la rapidite de sortie, avec tests automatises minimaux et blocage deploy si tests KO.
- Repo: GitHub public, licence "tous droits reserves", pas de PR obligatoire.

## Journal Q/R consolide (Q1-Q94)
1. Q1 - Public prioritaire: toi seul.
2. Q2 - Site public en lecture et toi seul en edition: oui.
3. Q3 - Connexion admin: mot de passe classique.
4. Q4 - Nombre de comptes admin: un seul.
5. Q5 - Nom du compte admin: Philippe Maraval.
6. Q6 - Email admin: philippe.maraval@protonmail.com.
7. Q7 - "Mot de passe oublie": non.
8. Q8 - Zone d affichage: metropole.
9. Q9 - Fond par defaut: OSM standard.
10. Q10 - Langue: francais uniquement.
11. Q11 - Categories V1: transports en commun, parcs, quartiers/arrondissements/secteurs.
12. Q12 - Geometries V1: transports (lignes + stations), parcs (polygones + points), quartiers/arrondissements/secteurs (polygones + points).
13. Q13 - Source de depart: donnees existantes.
14. Q14 - Strategie import: import unique puis edition locale.
15. Q15 - Source prioritaire: OSM pour tout.
16. Q16 - Vue initiale: centree Marseille ville.
17. Q17 - Calques actifs au demarrage: aucun; activation manuelle; cumulables.
18. Q18 - Style visuel: modifiable depuis admin.
19. Q19 - Contenu popup: a definir plus tard.
20. Q20 - Statut d avancement par element: oui.
21. Q21 - Statuts: existant, en cours, propose.
22. Q22 - Couleurs: choisies element par element via palette.
23. Q23 - Edition carte: creer/modifier/supprimer directement.
24. Q24 - Publication: immediate.
25. Q25 - Ajout de categories en admin: oui.
26. Q26 - Choix des geometries autorisees par categorie: oui.
27. Q27 - Champs personnalises par categorie: oui.
28. Q28 - Type + obligatoire pour champs: oui.
29. Q29 - Visibilite des champs: toujours publique.
30. Q30 - Recherche: plus tard.
31. Q31 - Filtres rapides V1: oui.
32. Q32 - Filtres prioritaires: statut + categorie.
33. Q33 - Panneau lateral liste elements visibles: oui.
34. Q34 - Tri par defaut: alphabetique; rangement perso plus tard.
35. Q35 - Ordre manuel: par categorie.
36. Q36 - Gestion ordre: glisser-deposer.
37. Q37 - Arrivee utilisateur: direct sur la carte.
38. Q38 - Mobile: fonctions admin completes (interprete).
39. Q39 - Edition: depuis la carte apres connexion.
40. Q40 - Duree session: indeterminee.
41. Q41 - Bouton connexion: discret.
42. Q42 - Multi-fonds de carte: oui.
43. Q43 - Fonds V1 retenus: OSM standard, satellite, carto clair, carto sombre, topographique.
44. Q44 - Legende: dynamique.
45. Q45 - Message si aucun calque: non.
46. Q46 - Chargement a la demande: non.
47. Q47 - Chargement de tous les calques au demarrage: oui.
48. Q48 - Limite d edition: metropole.
49. Q49 - Limite de consultation publique: metropole aussi.
50. Q50 - Quartiers/arrondissements/secteurs: 3 sous-calques separes.
51. Q51 - Transports: sous-calques metro/tram/BHNS/TER.
52. Q52 - Station multi-modes: un seul point.
53. Q53 - Etiquettes: au clic/survol seulement.
54. Q54 - Clustering dezoom: non (verrouille).
55. Q55 - Clustering par statut: aucun.
56. Q56 - Historique modifications: oui.
57. Q57 - Restauration version precedente: oui.
58. Q58 - Suppression: via corbeille.
59. Q59 - Purge corbeille automatique: non (suppression manuelle).
60. Q60 - Export admin: GeoJSON + CSV.
61. Q61 - Import initial OSM: script reproductible.
62. Q62 - Geometries en PostGIS: oui.
63. Q63 - Lib carte choisie: Leaflet.
64. Q64 - Front choisi: React + TypeScript + Vite.
65. Q65 - Architecture choisie: frontend direct Supabase.
66. Q66 - Direction visuelle: minimaliste.
67. Q67 - Theme: clair unique.
68. Q68 - Deploy auto `main` -> Cloudflare Pages: oui.
69. Q69 - Environnements: production seule.
70. Q70 - Protection admin via role RLS: oui.
71. Q71 - Second facteur: non.
72. Q72 - Longueur mini mot de passe: 10.
73. Q73 - Analytics V1: aucun.
74. Q74 - Mentions legales + politique confidentialite en V1: non.
75. Q75 - Attribution permanente en bas de carte: non.
76. Q76 - Sauvegardes auto quotidiennes: oui (correction finale).
77. Q77 - Sans objet apres correction Q76.
78. Q78 - Monitoring erreurs Sentry: non.
79. Q79 - Logs audit admin visibles en interface: non.
80. Q80 - SEO lancement: non indexe.
81. Q81 - Priorite apres V1: pietonnisation (pistes cyclables d abord evoque puis remplace).
82. Q82 - Date cible de mise en ligne: non contrainte ("je m en fiche").
83. Q83 - Arbitrage V1: rapidite de sortie.
84. Q84 - V1 sans tests automatises: non.
85. Q85 - Niveau de tests retenu: unitaires critiques + 1 smoke E2E (choix recommande).
86. Q86 - Blocage deploy si test echoue: oui (choix recommande apres "je ne sais pas").
87. Q87 - Strategie Git: `main` + branches courtes.
88. Q88 - Convention de commit (`feat:`, `fix:`, etc.): non.
89. Q89 - Pull Request obligatoire avant `main`: non.
90. Q90 - Roadmap en 3 phases: oui.
91. Q91 - Visibilite du repo GitHub: public.
92. Q92 - Lien vers le code source sur le site: non.
93. Q93 - Licence repo: tous droits reserves.
94. Q94 - Domaine perso au lancement: oui si gratuit, sinon non.

## Points ouverts
- Q95 a Q100 non traites.
- Structure exacte des popups/fiche element: non definie.
- Details SEO apres lancement public: non definis.
- Politique legale/conformite: non definie pour V1.

## Risques acceptes par le porteur (a date)
- Pas de pages legales en V1.
- Pas d attribution permanente des sources en bas de carte.
- Pas de monitoring erreurs.
- Pas d analytics.
- Session admin longue + mot de passe seul.

## Note de coherence
- Plusieurs reponses contradictoires ont eu lieu pendant les interruptions; la valeur retenue est toujours la derniere reponse explicite.
