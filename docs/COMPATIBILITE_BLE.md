# Compatibilité Bluetooth — AVDL A13 (appli officielle « YouFs », appareil « YouFs-B9 »)

Règle appliquée : **aucun identifiant (UUID) ni format de trame n'est inventé.** Tout ce qui dépend du protocole de l'A13 est marqué « non confirmé ».

## 1. Ce que l'on sait (sources)
| Information | Source | Fiabilité |
|---|---|---|
| L'appli officielle affiche l'appareil « YouFs-B9 » | Capture d'écran fournie | Certaine |
| L'appli officielle propose 5 niveaux de limite (10/20/45/35/35 km/h) | Capture d'écran fournie | Certaine |
| Une appli sœur du même éditeur (« YouFs-A », Shenzhen Yongfengshun) se connecte au véhicule en Bluetooth, **affiche vitesse, vitesse par rapport, kilométrage, batterie, et permet de régler la vitesse par rapport** | Fiche Google Play de YouFs-A | Indice seulement : pas la preuve que l'A13 utilise le même protocole |
| Des avis d'utilisateurs de YouFs-A signalent que « les réglages de vitesse se réinitialisent à l'allumage » et des échecs de connexion | Avis Google Play (individuels, non vérifiés) | Faible, à garder en tête |
| Protocole GATT (services, caractéristiques, trames) de l'A13 | **Aucune source publique trouvée** | **Inconnu** |
| Bluetooth BLE ou classique (SPP) ? | **Non établi** | **Inconnu** |

## 2. Fonctions : testées / non testées / non confirmées
| Fonction | Statut | Précision |
|---|---|---|
| Interface, logique de décodage, assistant d'analyse, garde-fous d'écriture | **Testé** (simulateur, 38 contrôles + 10 tests) | Contre un faux vélo, pas un A13 |
| Scan BLE, connexion GATT, services, lecture, notifications, MTU | **Code complet, non testé sur un A13** | Kotlin non compilé ici |
| Détection du vélo | Heuristique sur le nom (YouFs, AVDL, A13, B9) | Un vélo sans nom reste listable (« Afficher les appareils sans nom ») |
| Autorisations Android 6 → 15 | **Relues**, non exécutées sur les appareils | Voir §4 |
| Batterie / capteur vitesse-cadence **standards** | Fonctionne si le vélo expose ces services standards | Probablement absents de l'A13 |
| **Vitesse réelle du vélo** | **NON CONFIRMÉ** | Il faut le format des données : assistant ou capture |
| **Lecture / écriture des limites** | **NON CONFIRMÉ**, écriture verrouillée | Profil confirmé requis |

## 3. Améliorations apportées dans cette version
- **Détection** : type du périphérique (BLE / classique / double mode) et état d'appairage affichés ; un vélo appairé en **Bluetooth classique seul** est signalé comme bloquant (il est invisible au scan BLE).
- **Connexion** : une nouvelle tentative automatique unique après l’erreur 133 ou un délai dépassé (fréquente avec ces contrôleurs), annulable ; message dédié ; MTU testable (Labo) et inscrit dans le rapport.
- **Autorisations** : détection du refus définitif (« Ne plus demander ») avec bouton d'accès aux réglages de l'appli ; vérification de la localisation système avant Android 12 (sinon le scan reste vide sans erreur).
- **Contrôle de compatibilité** (Mon vélo → Connexion) : 11 points, chacun « Vérifié », « À faire », « Bloquant » ou « Non confirmé ».
- **Rapport de diagnostic** enrichi : autorisations, appairés, type, MTU, services, valeurs, notifications.

## 4. Autorisations par version d'Android
| Android | Autorisations demandées | Remarque |
|---|---|---|
| 6 à 11 (API 23–30) | `ACCESS_FINE_LOCATION` (+ `BLUETOOTH`, `BLUETOOTH_ADMIN`) | Localisation système obligatoire pour que le scan renvoie des résultats |
| 12 à 15 (API 31–35) | `BLUETOOTH_SCAN` (`neverForLocation`) et `BLUETOOTH_CONNECT` | La localisation n'est requise que pour le GPS du compteur |

## 5. Informations manquantes (à obtenir)
1. UUID du service et des caractéristiques de données de l'A13 → **rapport de diagnostic** (Mon vélo → Labo).
2. Emplacement de la vitesse dans les trames → **assistant** (comparaison avec le GPS) ou capture HCI de l'appli YouFs.
3. Trames de lecture/écriture des limites + somme de contrôle → **capture HCI** en changeant une seule limite dans YouFs (voir `PROFIL.md`).
4. Besoin d'appairage ou de commande « d'éveil » avant l'envoi des données → visible dans la capture.
5. Comportement des limites au redémarrage du vélo (réinitialisation éventuelle).

## 6. Procédure de validation sur le vélo
1. Fermer l'appli YouFs ; allumer le vélo ; Mon vélo → Rechercher ; connecter.
2. Lire le **Contrôle de compatibilité** : tout « Vérifié » jusqu'aux « Services découverts ».
3. Labo → Générer le rapport → l'envoyer.
4. Labo → Enregistrer en roulant (GPS) → Arrêter : lire le meilleur candidat, l'utiliser, comparer au GPS.
