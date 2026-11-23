# Profil de protocole (JSON) et capture HCI

## Capturer le protocole de l'appli officielle (Android)
1. Options développeur → **Activer le journal HCI Bluetooth** (snoop log). Redémarre le Bluetooth.
2. Ouvre l'appli YouFs, connecte-toi au vélo, change **un seul** niveau de limite (ex. niveau 2 : 20 → 24), puis reviens.
3. Récupère `btsnoop_hci.log` (rapport de bug ou dossier du téléphone) et ouvre-le avec Wireshark : filtre `btatt`. Repère les « Write Request/Command » (valeur écrite, handle) et les « Notification ».
4. Fais la même chose avec 2 valeurs différentes pour déduire la structure (niveau, valeur, somme de contrôle).

## Format
Champs : `name`, `confirmed` (true seulement si **vérifié**), `speed{service,char,offset,len,endian,signed,scale}`,
`limits{levels,min,max,levelBase,valueScale,read{command,service,writeChar,char,fields[],checksum},write{service,char,template,withResponse,checksum}}`.
Modèle d'écriture : octets hexadécimaux avec `{LEVEL}` et `{VALUE}` (ex. `AA55{LEVEL}{VALUE}`) ; sommes : `sum8`, `neg_sum8`, `xor8`, `crc16_modbus_le/be`.
Garde-fous : bornes 0 ≤ min < max ≤ 60, case de confirmation à l'import, écriture bloquée si `confirmed` est faux.
