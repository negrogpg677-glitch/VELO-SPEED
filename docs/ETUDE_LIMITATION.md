# Étude — configuration de la limitation de vitesse de l'AVDL A13

## 1. Le contrôleur autorise-t-il cette configuration ?
**Réponse : probable, mais NON CONFIRMÉ.** Rien n'est écrit dans le vélo tant que ce n'est pas établi.

| Élément | Constat | Source | Poids |
|---|---|---|---|
| L'appli officielle (YouFs) expose 5 réglages « speed_limit_1 à 5 » | Valeurs vues : 10 / 20 / 45 / 35 / 35 km/h | Capture d'écran de l'utilisateur | Fort : le contrôleur gère des limites par niveau |
| Une appli sœur du même éditeur règle la vitesse par rapport | Indiqué dans sa fiche | Google Play (YouFs-A) | Indice |
| Le constructeur du A13 évoque un déblocage | « Version UE limitée à 25 km/h » ; « déblocage jusqu'à 32 km/h » (méthode non décrite) | Fiche produit avdlbike.com | Fort : une limite modifiable existe côté constructeur |
| Écriture réellement acceptée par TON contrôleur en Bluetooth, protégée ou non (mot de passe, version UE verrouillée) | **Inconnu** | — | À tester |
| Format des trames (lecture, écriture, somme de contrôle) | **Inconnu** | — | À capturer |
| Persistance au redémarrage | **Inconnu** (avis d'utilisateurs de l'appli sœur : réinitialisation à l'allumage) | Avis Google Play | À tester |

**Incohérence à éclaircir :** la fiche constructeur annonce 3 niveaux d'assistance (6 / 15 / 25 km/h) alors que l'appli affiche 5 limites dont 45 et 35 km/h. Soit la capture montre des valeurs génériques de l'appli, soit le vélo a déjà été modifié. Seule la lecture réelle depuis le contrôleur le dira.

## 2. Cadre réglementaire (France / UE)
- Un VAE n'est un vélo que si l'assistance **ne fonctionne qu'en pédalant, se coupe à 25 km/h et que le moteur fait ≤ 250 W**. Au-delà : cyclomoteur (immatriculation), interdit sur la voie publique pour un VAE « débridé » (service-public.gouv.fr).
- Ce vélo : moteur 250 W annoncé, roues de 16″, **conçu pour des adolescents de 140 à 175 cm, 120 kg maximum**, 28 kg, freins à disque.
- Conséquence : l'appli n'autorise le dépassement de 25 km/h que pour un **terrain privé fermé**, avec avertissements renforcés **au-dessus de 32 km/h** (limite maximale évoquée par le constructeur).

## 3. Conception du module (déjà dans l'appli)
Aucune écriture sans **les cinq prérequis**, affichés à l'écran :
1. Protocole **confirmé** par une capture réelle (profil « confirmé » importé volontairement) ;
2. bornes de sécurité du profil valides (0 ≤ min < max ≤ 60) ;
3. vélo connecté ;
4. **lecture réussie de tous les niveaux** ;
5. **valeurs d'origine sauvegardées** (automatique à la première lecture).

Ensuite, pour chaque écriture : confirmation explicite ; case « terrain privé » au-dessus de 25 km/h ; double avertissement au-dessus de 32 km/h ; relecture de vérification ; journal ; bouton « Restaurer l'origine ». Une **requête de lecture par trame est traitée comme une écriture** et reste bloquée tant que le profil n'est pas confirmé. Il n'existe aucune écriture « libre » (octets bruts).

## 4. Procédure pour passer de « probable » à « confirmé » (sans rien modifier d'abord)
1. **Lecture seule** : rapport de diagnostic + capture HCI de l'appli YouFs **en la laissant seulement afficher** les limites.
2. Identifier les trames de lecture et le codage des valeurs ; vérifier que les 5 valeurs lues correspondent à l'écran de l'appli officielle.
3. Importer un profil **de lecture** : l'appli lit les limites sans écrire.
4. Capture d'**un seul** changement via l'appli officielle (ex. niveau 1 : 10 → 12 km/h) pour déduire l'écriture et la somme de contrôle.
5. Premier essai **à 12 ou 15 km/h, vélo sur béquille**, valeur ≤ 25 ; vérifier la relecture, le redémarrage du vélo (persistance), puis « Restaurer l'origine ».
6. Seulement après : envisager d'autres valeurs, sur terrain privé.

Arrêt immédiat si : réponse illisible, valeur relue différente, comportement inattendu du moteur, erreur de somme de contrôle.
