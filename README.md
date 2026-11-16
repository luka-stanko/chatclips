# chat-clips

**Les meilleurs moments d'un live Twitch, trouvés par le chat, coupés en clips verticaux.**

Quand il se passe un truc de fou en live, le chat explose. `chat-clips` repère ces explosions et coupe chaque moment en clip 9:16, prêt pour TikTok, Reels et Shorts. Le clip commence 20 secondes avant que le chat réagisse, parce que le chat réagit toujours après coup.

```bash
node chat-clips.mjs "https://www.twitch.tv/videos/123456789"
```

Une commande, un dossier de clips.

> **Ne clippe que les streamers qui l'autorisent.**

---

## Ce qu'il fait

- Il **télécharge le chat** de la VOD avec [TwitchDownloader](https://github.com/lay295/TwitchDownloader) (gratuit, open source).
- Il **repère les pics** : quand le chat écrit 3 fois plus que d'habitude, ou quand il **réagit** 3 fois plus que d'habitude (PTDR, MDR, KEKW, 😂, 🔥, « wesh », « no way », jajaja, kkkk…).
- Il **marche aussi sur les très gros chats**. TwitchDownloader ne garde que 15 messages par seconde : sur un énorme live, le volume ne peut plus monter, mais la part de rires, si.
- Il **fait passer après les votes du chat** : quand le streamer pose une question et que tout le monde répond « oui », « non » ou un prénom, le chat explose aussi, mais ce n'est pas un clip.
- Il **ignore les bots** (Nightbot, StreamElements…), les commandes `!…` et les annonces d'abonnement. Une même personne compte au maximum 2 messages par tranche de 10 s : un spammeur seul ne crée pas de faux pic.
- Il **télécharge seulement les moments trouvés** (30 s chacun), pas les 14 Go d'un live de 6 heures en 1080p.
- Il **coupe chaque moment en 1080 × 1920**, en plein écran ou sur un fond flou, avec si tu veux **la face cam du streamer en bas** et le jeu en haut.

## Installation (une seule fois)

### 1. Ouvrir un terminal dans le dossier de chat-clips

- **Mac** : ouvre l'app **Terminal**, tape `cd ` (avec un espace), glisse le dossier `chat-clips` dans la fenêtre, puis appuie sur Entrée.
- **Windows 11** : dans l'Explorateur, clic droit sur le dossier `chat-clips` › **Ouvrir dans le Terminal**.

Toutes les commandes ci-dessous se tapent dans ce terminal.

### 2. Installer ce qu'il faut

1. **Node.js** 18 ou plus : https://nodejs.org (bouton « LTS »).
2. **ffmpeg** :
   - **Mac** : installe d'abord Homebrew (https://brew.sh). À la fin, Homebrew affiche des lignes « Next steps » à copier dans le terminal : fais-le, sinon la commande `brew` reste introuvable. Ensuite :
     ```bash
     brew install ffmpeg
     ```
   - **Windows** :
     ```powershell
     winget install Gyan.FFmpeg
     ```
     Puis ferme le terminal et ouvres-en un nouveau.
3. **chat-clips** : bouton vert **Code** › **Download ZIP** sur cette page, puis dézippe-le (ou `git clone`).
4. **TwitchDownloaderCLI** : sur https://github.com/lay295/TwitchDownloader/releases, télécharge le zip **CLI** de ton système, dézippe-le, et mets `TwitchDownloaderCLI` dans le dossier `chat-clips` (sur Windows, son dossier dézippé peut rester tel quel à l'intérieur) :
   - Mac Apple Silicon (M1, M2, M3, M4) : `TwitchDownloaderCLI-…-MacOSArm64.zip`
   - Mac Intel : `TwitchDownloaderCLI-…-MacOS-x64.zip`
   - Windows : `TwitchDownloaderCLI-…-Windows-x64.zip`

   **Sur Mac**, autorise-le une fois (dans le terminal ouvert à l'étape 1) :
   ```bash
   chmod +x TwitchDownloaderCLI
   xattr -c TwitchDownloaderCLI
   ```

## Utilisation

**Tout en une commande.** Mets toujours le lien entre guillemets (les liens Twitch contiennent souvent `?` ou `&`) :

```bash
node chat-clips.mjs "https://www.twitch.tv/videos/123456789"
```

Le numéro de la VOD tout seul marche aussi :

```bash
node chat-clips.mjs 123456789
```

Les clips arrivent dans le dossier `clips/`, avec le chat et la liste des moments (`moments.csv`). Pour un gros live, le chat met quelques minutes à se télécharger. Il est gardé : relancer avec d'autres options est ensuite immédiat.

**Voir d'abord les moments**, sans télécharger de vidéo :

```bash
node chat-clips.mjs "https://www.twitch.tv/videos/123456789" --liste
```

Chaque moment a un lien Twitch qui ouvre la VOD là où le clip commence, pour vérifier.

**Si tu as déjà le chat** (exporté en JSON par TwitchDownloader) :

```bash
node chat-clips.mjs chat.json --telecharger
```

**Si tu as déjà la vidéo** :

```bash
node chat-clips.mjs chat.json --vod live.mp4
```

Si tu n'as gardé qu'un morceau du live, coupe le chat et la vidéo de la même façon avec les options `-b` et `-e` de TwitchDownloader. L'outil recale les temps tout seul.

## Exemple

Extrait d'un vrai lancement sur un live GTA RP de 6 h (nom de la chaîne masqué), avec `--nombre 4 --qualite 360p30` :

```
Chat : 22 118 messages (+ 749 de bots, de commandes ou d'annonces, ignorés) · chaîne …

 #  Moment     Messages   × chat   × réactions   Le chat dit
 1  3:02:10          26   ×4.4     ×18.0        🤣, mdr, eh
 2  3:45:30          35   ×9.1     ×21.0        🤣, 😂, fou
 3  4:02:20          31   ×8.7     ×16.0        omg, ih, pain
 4  4:31:20          35   ×15.8    ×25.0        🤣, mdr, 😂

Téléchargement des 4 moments (360p30) et découpe (plein écran 9:16) dans « clips »…
  ✔ clip-01-3h02m10.mp4  (live 3:01:40 → 3:02:10)
  ✔ clip-02-3h45m30.mp4  (live 3:45:00 → 3:45:30)
  ✔ clip-03-4h02m20.mp4  (live 4:02:00 → 4:02:30)
  ✔ clip-04-4h31m20.mp4  (live 4:30:50 → 4:31:20)

4 clips prêts. La liste des moments est dans clips/moments.csv.
```

« × chat » : combien de fois plus le chat écrit que d'habitude (une réaction compte 1,5). « × réactions » : combien de fois plus il rit ou réagit que d'habitude.

## La face cam du streamer

Beaucoup de lives montrent le streamer dans un coin de l'image. Avec `--facecam`, le clip met **le jeu en haut et la face cam en bas** (1080 × 1920), pour voir la réaction du streamer en même temps que l'action :

```bash
node chat-clips.mjs "https://www.twitch.tv/videos/123456789" --facecam haut-gauche
```

Les clips gardent en haut la partie du jeu où la face cam ne se trouve pas, pour qu'elle ne soit pas montrée deux fois. Avec `--position`, c'est toi qui choisis le recadrage.

**Vérifie d'abord le cadrage.** Chaque face cam a sa taille et sa place. `--facecam haut-gauche` en devine une (30 % de la largeur, en 16:9) :

1. Lance la commande avec `--apercu` : l'outil télécharge un seul moment et fabrique `clips/apercu-facecam.png`, une image du live avec un **cadre rouge** autour de ce qu'il prend pour la face cam. Aucun clip n'est coupé.
2. Le cadre est à côté ? Donne la place exacte, en % de l'image : `--facecam x,y,largeur,hauteur`. Par exemple `--facecam 1.6,2.3,29.5,29.5` : à 1,6 % du bord gauche, 2,3 % du haut, large de 29,5 % et haut de 29,5 %.
3. Quand le cadre rouge entoure bien la face cam, relance **la même commande sans `--apercu`** : le chat est déjà téléchargé, ça part tout de suite.

La face cam est agrandie pour remplir la largeur du clip : garde la qualité par défaut (1080p60), sinon elle sera floue. L'outil te prévient quand elle l'est.

## Options

| Option | Ce qu'elle fait | Par défaut |
|---|---|---|
| `--liste` | Liste seulement les moments, sans télécharger de vidéo ni couper | |
| `--nombre 10` | Nombre de clips au maximum | 10 |
| `--avance 20` | Secondes gardées avant que le chat réagisse | 20 |
| `--duree 30` | Durée de chaque clip | 30 s |
| `--facecam haut-gauche` | Le jeu en haut, la **face cam** du streamer en bas. Où est-elle ? `haut-gauche`, `haut-droite`, `bas-gauche`, `bas-droite`, ou ses coordonnées `x,y,largeur,hauteur` en % de l'image | pas de face cam |
| `--facecam-taille 30` | Avec un coin : largeur de la face cam, en % de la largeur de l'image | 30 |
| `--apercu` | Avec `--facecam` : fabrique seulement l'image `apercu-facecam.png` (cadre rouge autour de la face cam), sans couper les clips | |
| `--flou` | Garde toute l'image sur un fond flou (avec `--facecam` : pour la partie jeu) | plein écran |
| `--position 50` | Où recadrer le jeu en plein écran : 0 = à gauche, 100 = à droite | 50 (centre) |
| `--qualite 1080p60` | Qualité téléchargée | 1080p60 |
| `--dossier clips` | Dossier de sortie | `clips` |
| `--twitch <chemin>` | Où trouver TwitchDownloaderCLI | dossier de chat-clips |
| `--telecharger` | Avec un `chat.json` : télécharge seulement les moments | |
| `--vod live.mp4` | Avec un `chat.json` : coupe dans une vidéo déjà téléchargée | |
| `--vod-complete` | La vidéo est le live entier, mais le chat a été coupé avec `-b` | |
| `--seuil 3` | Un pic : 3 fois plus de messages, ou 3 fois plus de réactions, que d'habitude | 3 |
| `--min 15` | Un pic doit compter au moins 15 messages | 15 |
| `--fenetre 10` | Taille des tranches où on compte les messages | 10 s |
| `--votes` | Garde les votes du chat au même rang que les autres pics | |

## Astuces

- **Une facecam dans un coin** : le recadrage au centre la coupe. Utilise `--facecam` (voir juste en dessous) pour la mettre en bas du clip.
- **Plusieurs caméras** : utilise `--flou` pour garder toute l'image, ou `--position 0` / `--position 100` pour cadrer à gauche ou à droite.
- **Petit streamer, chat calme** : `--seuil 2 --min 8`.
- **Trop de moments moyens** : `--nombre 5` garde seulement les plus forts.
- **Un moment qui dure** (une course-poursuite, un fou rire) : `--duree 45`.
- **« (vote ?) » dans la liste** : le chat répond surtout la même chose. Le streamer a sans doute posé une question. Ces pics passent après les autres.
- **« cette VOD est réservée aux abonnés »** : TwitchDownloader ne peut pas la lire. Choisis une VOD publique.
- **« cette VOD n'existe plus »** : les VOD ne restent sur Twitch que quelques jours ou semaines selon la chaîne. Clippe vite.
- **Ctrl+C** arrête l'outil proprement : rien d'inachevé ne reste dans le dossier.

## Comment ça marche

1. Les messages sont rangés par tranches de 10 secondes. Une réaction (rire, emoji, « wow », « wesh »…) compte une fois et demie.
2. Le **rythme normal** est la médiane du chat sur 5 minutes de chaque côté. Il suit le live : un chat plus calme au début, plus actif à la fin. Le rythme normal des réactions est calculé pareil.
3. Un **pic**, c'est une tranche d'au moins 15 messages, qui fait au moins 3 fois le rythme normal du chat, ou 3 fois celui des réactions. Quand le chat touche le plafond de TwitchDownloader (15 messages par seconde), il suffit que les réactions doublent.
4. Un pic avec presque aucune réaction (moins de 12 %), surtout des réponses courtes (plus de 55 %) et souvent les mêmes est un **vote** : ses réponses ne comptent plus qu'à 20 %.
5. Les tranches de pic qui se suivent forment un seul moment, et on garde les plus forts, sans que deux clips se chevauchent.
6. Chaque clip commence 20 s avant que le chat se mette à réagir (jusqu'à 20 s plus tôt que le pic lui-même, si la réaction monte sur plusieurs tranches).

Testé sur 4 vrais lives (en français, anglais et espagnol, jusqu'à 137 000 messages, dont deux streamers à plus d'un million de vues), et sur un chat synthétique de 900 000 messages (620 Mo) : le fichier est lu par morceaux, sans limite de taille.

## Tests

```bash
npm test
```

## Licence

MIT. Fait par [@luka.stkn](https://www.instagram.com/luka.stkn/).
