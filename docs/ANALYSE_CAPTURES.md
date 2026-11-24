# Analyse des captures de l'appli officielle (YouFs) — 23/11/2026

## 1. Ce que les captures montrent (constats)
- **Appareil** « YouFs-B9 », état « Connected » (Bluetooth), batterie 85 %.
- **Page d'accueil** : kilométrage trajet / autonomie estimée / total, carte « Riding Map » (position du téléphone), « Recent Ride », « Riding Archive » (non activé), interrupteurs **Cruise**, **Headlight**, **Start mode**, bouton cadenas.
- **Page « More »** : Battery lock, Energy Recovery Level (low), Unit Set (km), Current temperature, Fault detection, **speed_limit_1 à 5**, autopoweroff time (10 min), Battery status, Cycle Times, Current Voltage (40,40 V), Electric Current, Current power, Battery Temperature, Battery Capacity.
- **Limites vues** : niveau 1 = 15, niveau 2 = 25, niveau 3 = 45, niveau 4 = 35, niveau 5 = 35 km/h (17:45) puis 50 km/h au curseur (17:48). **Le curseur du niveau 5 va de 20 à 50 km/h** : c'est la plage acceptée par le réglage.
- **Aucune vitesse instantanée** n'apparaît sur ces écrans (vélo à l'arrêt).
- Un message « Status : normal » avec un bouton en chinois (« 确认 ») : application d'origine chinoise.

## 2. Hypothèse principale : plateforme Tuya (NON CONFIRMÉE)
Indices : écran « Ajouter un appareil / Recherche d'appareils à proximité » avec catégories (Électrique, Éclairage, Prise…), capsule « … ✕ » en haut à droite d'un panneau, assistant IA en bas, noms de réglages en minuscules à la Tuya (`speed_limit_1`, `autopoweroff time`), et la fiche de l'appli sœur au slogan « Smart Life, Smart Living ». **Contre-indice** : les fiches de la boutique d'applications ne citent pas Tuya.

Si c'est Tuya, la documentation publique du SDK BLE Tuya indique :
- service GATT **0x1910**, caractéristiques **0x2B10** (notifications) et **0x2B11** (écriture) ;
- annonce : service **0xA201**, données constructeur de l'identifiant **0x07D0** ;
- **échanges chiffrés** (AES-128, clé d'authentification) ; valeurs sous forme de « points de données » (identifiant, type, longueur, valeur) ;
- une bibliothèque communautaire précise qu'une session exige l'**identifiant de l'appareil et une clé locale** que seul le **compte propriétaire** de l'appareil peut obtenir via le cloud du fabricant.

Conséquences :
1. Une capture Bluetooth de l'appli officielle serait **chiffrée** : elle ne suffit plus à décoder les limites.
2. Le profil « en clair » de VELO SPEED **ne peut pas fonctionner** sur un appareil Tuya.
3. Lire la vitesse ou régler les limites demanderait d'implémenter le protocole Tuya BLE **et** d'obtenir la clé locale de ton compte : chantier important, jamais vérifié sur ton vélo, à décider séparément.

L'appli détecte maintenant cette signature (annonce 0xA201 / 0x07D0, service 0x1910) et l'indique dans le contrôle de compatibilité. **Un scan du vélo allumé suffit à trancher.**

## 3. Faits utiles pour les limites
- Les limites sont bien **modifiables depuis l'appli officielle** (curseur et bouton Save) : le contrôleur les accepte.
- Plage observée : **20 à 50 km/h** pour le niveau 5 (autres niveaux : à relever).
- Les valeurs ont changé entre tes captures (niveaux 1 et 2 : 10/20 puis 15/25) : **note les valeurs d'usine** avant tout nouveau réglage ; c'est ce que « Restaurer l'origine » devra remettre.
- Sécurité : 45 à 50 km/h dépassent largement ce que le constructeur annonce pour ce modèle (25 km/h, déblocage jusqu'à 32 km/h), pour un vélo de 16″ de 28 kg conçu pour 140–175 cm. Voir `ETUDE_LIMITATION.md`.

## 4. Point bloquant à clarifier : le téléphone
Les captures proviennent d'un **iPhone**. VELO SPEED est Android uniquement. Il faut donc un téléphone **Android** pour l'installer. La capture HCI décrite dans `PROFIL.md` n'existe aussi que sur Android.

## 5. Suite proposée
1. Installer l'APK sur un Android, scanner le vélo allumé, lire le contrôle de compatibilité (signature Tuya oui / non).
2. Générer le rapport de diagnostic (services, annonce brute).
3. Selon le résultat : (a) pas de signature Tuya → assistant d'analyse et capture HCI ; (b) signature Tuya → décider si on implémente le protocole Tuya BLE avec la clé locale de ton compte, ou si on se limite au compteur GPS.

## 6. Relevé nRF Connect du vélo « demo » (24/11/2026) — Tuya CONFIRMÉ
Le vélo s'annonce sous le nom **« demo »** (adresse Android vue : DC:23:52:93:CF:A7).
- **Données constructeur** : identifiant **0x07D0 = Hangzhou Tuya Information Technology** — `00 00 01 00 F2 4E 0D EF 35 85 51 7C 31 D0 1C 4F 2D 58 29 7A`.
- **Service annoncé** : **0xFD50** (service Bluetooth attribué à Tuya) ; données de service `41 04 00 08` + `7A 36 74 6C 77 73 6D 71` = identifiant produit Tuya probable **« z6tlwsmq »**.
- **Services GATT** : 1800, 1801 et **FD50** avec trois caractéristiques :
  - `00000001-0000-1001-8001-00805f9b07d0` : écriture (avec / sans réponse) ;
  - `00000002-0000-1001-8001-00805f9b07d0` : notifications (CCCD 2902) ;
  - `00000003-0000-1001-8001-00805f9b07d0` : lecture.
- Pas de DFU Nordic / McuMgr (normal).

**Conclusion** : c'est le protocole **Tuya BLE récent** (service FD50, pas l'ancien 0x1910). nRF Connect affiche « Connected » pour la même raison que VELO SPEED : seule la liaison radio est ouverte. Le vélo n'affiche le logo Bluetooth et n'envoie la vitesse qu'après l'authentification chiffrée (AES-128), qui exige l'**identifiant de l'appareil, son UUID et sa clé locale** (compte propriétaire, cloud Tuya). Ce format correspond à celui géré par l'intégration communautaire Home Assistant « tuya_ble ».

L'appli (v2.0.2) reconnaît désormais FD50 comme signature Tuya et n'affiche plus « Connecté » à tort pour ce vélo.
