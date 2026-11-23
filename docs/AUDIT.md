# Audit technique — VELO SPEED

## Projet d'origine (ZIP ChatGPT « Python/Kivy v2 »)
- Impossible à compiler en l'état (chaîne Buildozer/Kivy fragile, dépendances Python Bluetooth non portables sur Android).
- Bluetooth : pas de moteur GATT fiable ; UUID/protocoles supposés ; vitesse « simulée ».
- Permissions Android 12+ absentes ou incorrectes ; textes en partie non français.
→ Décision : réécriture en Android natif (Kotlin) + interface locale.

## Architecture actuelle
BleController (scan, connexion, file d'opérations GATT, watchdog 6 s, délai de connexion 20 s) · GpsController · NativeBridge (pont JS) · MainActivity (WebView verrouillée sur `file:///android_asset/`).

## Correctifs issus de la relecture Kotlin indépendante
Garde-fou d'écriture évalué à l'appel et remis à zéro à la déconnexion · file GATT : un retour tardif ne clôt plus l'opération suivante, liaison refermée après délai · découverte de services contrôlée · scan Android ≤ 11 : localisation système exigée et signalée · WebView détruite protégée · filtre de navigation compatible API 23 · GPS : abonnement même si désactivé au départ.

## Compatibilité Android 6 → 15
BLUETOOTH_SCAN/CONNECT (API 31+), ACCESS_FINE_LOCATION (scan ≤ 30 et GPS), BLUETOOTH/ADMIN limitées à l'API 30, API 33+ : nouvelles signatures GATT gérées.

## Limites de cette vérification
Pas d'accès au SDK Android ni au réseau ici : **le Kotlin n'a pas été compilé et l'APK n'a pas été construit ni installé**. Testés : logique JS (10 tests) et interface complète (27 contrôles) avec un faux pont Bluetooth. Le premier build GitHub peut révéler des erreurs de compilation à corriger.
