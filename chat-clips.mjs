#!/usr/bin/env node
// chat-clips.mjs : trouve les meilleurs moments d'un live Twitch grâce au chat,
// et les coupe en clips verticaux 9:16.
//
// Le principe : quand il se passe un truc de fou, le chat explose. L'outil
// compte les messages toutes les 10 secondes, repère les pics par rapport au
// rythme normal du chat autour, et coupe chaque clip 20 secondes AVANT que le
// chat réagisse, parce que le chat réagit toujours après le moment.
//
// Il s'appuie sur TwitchDownloader (gratuit, open source) :
//   https://github.com/lay295/TwitchDownloader
//
// Utilisation :
//   node chat-clips.mjs "https://www.twitch.tv/videos/123456789"
//       tout en une commande : chat, moments, puis seulement ces moments en vidéo
//   node chat-clips.mjs chat.json                  liste les moments d'un chat déjà téléchargé
//   node chat-clips.mjs chat.json --vod live.mp4   coupe les clips dans une vidéo déjà téléchargée
//   node chat-clips.mjs --aide                     toutes les options
//
// Il faut Node.js 18 ou plus, et ffmpeg pour couper les clips.
// Ne clippe que les streamers qui l'autorisent.

import {
  mkdirSync, writeFileSync, existsSync, statSync, unlinkSync, renameSync, readdirSync,
  createReadStream,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createGunzip } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { join, basename, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const AIDE = `
chat-clips : les meilleurs moments d'un live Twitch, trouvés par le chat.

  node chat-clips.mjs "<lien de la VOD Twitch>" [options]   tout en une commande
  node chat-clips.mjs <chat.json> [options]                 à partir d'un chat déjà téléchargé

Mets toujours le lien entre guillemets. Le numéro de la VOD seul marche aussi :
  node chat-clips.mjs 123456789

Avec un lien Twitch, l'outil télécharge le chat, trouve les moments, puis
télécharge SEULEMENT ces moments (30 s chacun) et les coupe en vertical.
Il lui faut TwitchDownloaderCLI (dans le même dossier, ou --twitch <chemin>).

Avec un chat.json, il liste les moments. Pour couper les clips, ajoute :
  --vod <fichier>     la vidéo du live, si tu l'as déjà téléchargée en entier
  --telecharger       ou : télécharge seulement les moments avec TwitchDownloaderCLI

Options :
  --nombre <n>        nombre de clips au maximum (10 par défaut)
  --avance <s>        secondes gardées avant la réaction du chat (20 par défaut)
  --duree <s>         durée de chaque clip en secondes (30 par défaut)
  --facecam <où>      le jeu en haut, la FACE CAM du streamer en bas. Dis où elle est
                      dans l'image : haut-gauche, haut-droite, bas-gauche, bas-droite,
                      ou ses coordonnées exactes en % de l'image : x,y,largeur,hauteur
                      (exemple : 2,2,30,30)
  --facecam-taille <n>  avec un coin : largeur de la face cam, en % de la largeur de
                      l'image (30 par défaut)
  --apercu            avec --facecam : fabrique seulement l'image apercu-facecam.png
                      (un cadre rouge autour de la face cam) pour vérifier le cadrage,
                      sans couper les clips
  --flou              garde toute l'image sur un fond flou : pour un live avec
                      plusieurs caméras (avec --facecam : pour la partie jeu)
  --position <0-100>  où recadrer le jeu en plein écran : 0 = à gauche, 50 = au centre
                      (par défaut), 100 = à droite
  --qualite <q>       qualité téléchargée (1080p60 par défaut ; sinon la meilleure)
  --liste             liste seulement les moments, sans rien télécharger ni couper
  --dossier <nom>     dossier de sortie ("clips" par défaut)
  --twitch <chemin>   où trouver TwitchDownloaderCLI
  --fenetre <s>       taille des tranches où on compte les messages (10 par défaut)
  --seuil <x>         un pic : x fois plus de messages, ou x fois plus de réactions,
                      que d'habitude (3 par défaut)
  --min <n>           un pic doit compter au moins n messages (15 par défaut)
  --votes             garde les votes du chat (« oui », « non », un prénom répété
                      par tout le monde) au même rang que les autres pics
  --vod-complete      avec --vod : la vidéo est le live entier, mais le chat a été
                      coupé (option -b de TwitchDownloader)
  --aide              affiche cette aide

Les bots (Nightbot, StreamElements…), les commandes « !… » et les annonces
d'abonnement sont ignorés, et une même personne compte au plus 2 messages par tranche.
`;

// ---------- Vocabulaire du chat ----------

// Mots qui montrent que le chat réagit à un moment fort. Un message qui en
// contient un compte une fois et demie. La détection se fait mot par mot,
// sans expression régulière à répétition : un spam de 500 caractères ne peut
// pas la bloquer.
const MOTS_HYPE = new Set([
  // anglais, Twitch
  "lmao", "lmfao", "lol", "lul", "lulw", "kekw", "omegalul", "icant", "pog", "pogchamp",
  "poggers", "pogu", "noway", "wtf", "omg", "omfg", "clip", "clipped", "clipit", "w",
  "insane", "pepelaugh", "wow", "woah", "whoa", "what", "huh", "bruh", "sheesh", "gg",
  "rip", "f", "holy", "nah", "crazy", "letsgo", "dead",
  // français
  "ptdr", "mdr", "xd", "jpp", "ahah", "haha", "dinguerie", "incroyable", "ouf",
  "masterclass", "waw", "wsh", "wesh", "ptn", "putain", "quoi", "malaise", "enorme",
  "énorme", "olala", "oula", "oulala", "chaud", "ouah", "waouh", "wouah",
  // espagnol, portugais, italien, allemand
  "jaja", "jajaja", "god", "dios", "brutal", "increible", "increíble", "tremendo", "locura",
  "joder", "hostia", "ostia", "ostras", "crack", "kkk", "caraca", "nossa", "rsrs",
  "madonna", "krass",
  // japonais, coréen, russe
  "草", "ㅋㅋ", "ㅋㅋㅋ", "ㅎㅎ", "хаха", "ахах", "кек", "лол",
]);
// Un mot fait d'un motif répété : « LULLUL », « hahaha », « jajaja », « kkkk », « wwww »…
const MOTIFS_REPETES = [
  "ha", "ah", "he", "hi", "ja", "je", "js", "k", "rs", "xa", "ㅋ", "ㅎ", "ха", "ах", "草",
  "lol", "lul", "kek", "kekw", "xd", "w", "mdr", "ptdr", "lmao", "pog",
];
// Des cris étirés : « AHHHH », « NOOOON », « NAAAAN », « OHHHH ». Écrits
// normalement (« non », « nan »), ce sont des réponses de vote : seule la
// version étirée (3 lettres pareilles ou plus) compte comme une réaction.
const CRIS_ETIRES = new Set(["ah", "oh", "eh", "ih", "uh", "ay", "aie", "non", "nan", "no", "nein", "noo"]);
// Expressions de plusieurs mots, cherchées dans le message mis en minuscules.
const EXPRESSIONS_HYPE = [
  "no way", "nan mais", "clip ça", "clip ca", "clip it", "clip that", "lets go", "let s go",
  "no shot", "holy shit", "oh my god", "le sang", "c est chaud", "je suis mort", "jsuis mort",
  "mort de rire",
];
const EMOJIS_HYPE = ["😂", "🤣", "💀", "😭", "🔥", "😱", "😳", "🤯", "😮", "😨", "😲", "😵", "🫢", "🫨", "😹", "‼", "⁉"];

// Bots connus : leurs messages (modération, alertes, commandes) ne comptent pas.
const BOTS = new Set([
  "nightbot", "streamelements", "streamlabs", "moobot", "wizebot", "fossabot",
  "sery_bot", "soundalerts", "botrixoficial", "kofistreambot", "pokemoncommunitygame",
  "blerp", "streamlootsbot", "commanderroot", "deepbot", "coebot", "phantombot",
  "ankhbot", "vivbot", "songlistbot", "frostytoolsdotcom", "own3d", "streamstickers",
  "lurxx", "tangiabot", "wzbot", "botisimo", "pretzelrocks",
]);
const estBot = (nom) => BOTS.has(nom) || /bot$/.test(nom);
// Les « W gifter », « merci pour les subs » : le chat applaudit un don, pas un moment du stream.
const RE_DONS = /\b(gift(ed|er|ers|ing|s)?|subs?|resub|subbed|dono|donation)\b/i;
// Les annonces d'abonnement que Twitch glisse dans le chat (toujours en anglais).
const RE_ANNONCE = /^\S+ (subscribed (at Tier \d|with Prime)|gifted (a|\d+) Tier \d|is gifting \d+ Tier \d|is paying forward|converted from a Prime|is continuing the Gift)/i;

// Mots trop courants pour dire quoi que ce soit dans la colonne « Le chat dit ».
const MOTS_VIDES = new Set((
  "le la les l de des du d un une et en est es il ils elle elles je j tu t on nous vous a à au aux " +
  "ce cet cette ces c ca ça qui que qu quoi pas ne n se s sa son ses mon ma mes m ton ta tes pour par " +
  "sur dans avec mais ou où donc y lui leur moi toi trop tres très bien fait faire comme tout tous " +
  "the a an to of and is it its in i you he she we they this that for on with be are was so my your " +
  "me just do not no yes oh"
).split(" "));

// TwitchDownloader ne garde jamais plus de 15 messages par seconde.
const PLAFOND_PAR_SECONDE = 15;

const ICI = dirname(fileURLToPath(import.meta.url));
const NOM_SCRIPT = basename(fileURLToPath(import.meta.url));

// ---------- Petits outils ----------

class ErreurChat extends Error {}

function arreter(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const entreGuillemets = (s) => (/[\s?&*()'"<>|;$`!#\[\]{}~]/.test(s) ? `"${s}"` : s);

function hms(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}
function hmsLien(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}
function hmsFichier(s) {
  return hms(s).replace(/:/g, "h").replace(/h(\d\d)$/, "m$1");
}

// ---------- Arguments ----------

// La face cam : un coin (haut-gauche…) ou un rectangle x,y,largeur,hauteur en % de l'image.
const COINS_FACECAM = { "haut-gauche": [0, 0], "haut-droite": [1, 0], "bas-gauche": [0, 1], "bas-droite": [1, 1] };
function lireFacecam(texte) {
  const t = String(texte).trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (t in COINS_FACECAM) return { coin: COINS_FACECAM[t] };
  const aide = "--facecam attend un coin (haut-gauche, haut-droite, bas-gauche, bas-droite)\n  ou 4 nombres x,y,largeur,hauteur en % de l'image (exemple : 2,2,30,30).";
  const n = t.split(/[,;]/).map((s) => (s.trim() === "" ? NaN : Number(s)));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) arreter(`« ${texte} » : ${aide}`);
  const [x, y, l, h] = n;
  if (x < 0 || y < 0 || l < 5 || h < 5 || x + l > 100.01 || y + h > 100.01) {
    arreter(`« ${texte} » : la face cam sort de l'image (x, y, largeur, hauteur en % ; largeur et hauteur d'au moins 5).`);
  }
  return { x, y, l, h };
}

function lireArguments(argv) {
  const o = {
    entree: null, vod: null, nombre: 10, avance: 20, duree: 30, fenetre: 10, seuil: 3, min: 15,
    flou: false, position: 50, qualite: "1080p60", liste: false, telecharger: false,
    twitch: null, dossier: "clips", vodComplete: false, votes: false,
    facecam: null, facecamTaille: 30, apercu: false,
  };
  const nombres = { // option : [clé, valeur minimale]
    "--nombre": ["nombre", 1], "--avance": ["avance", 0], "--duree": ["duree", 1],
    "--fenetre": ["fenetre", 1], "--seuil": ["seuil", 1], "--min": ["min", 1], "--position": ["position", 0],
    "--facecam-taille": ["facecamTaille", 5],
  };
  const textes = {
    "--vod": "vod", "--dossier": "dossier", "--qualite": "qualite", "--twitch": "twitch", "--facecam": "facecam",
  };
  const drapeaux = {
    "--flou": "flou", "--liste": "liste", "--telecharger": "telecharger",
    "--vod-complete": "vodComplete", "--votes": "votes", "--apercu": "apercu",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--aide" || a === "-h" || a === "--help") { console.log(AIDE); process.exit(0); }
    if (a in drapeaux) o[drapeaux[a]] = true;
    else if (a in textes) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) arreter(`${a} attend une valeur.`);
      o[textes[a]] = v;
    } else if (a in nombres) {
      const [cle, mini] = nombres[a];
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < mini) arreter(`${a} attend un nombre (${mini} au minimum).`);
      o[cle] = v;
      if (cle === "position") o.positionDonnee = true;
    } else if (a.startsWith("--")) arreter(`option inconnue : ${a} (voir --aide)`);
    else if (!o.entree) o.entree = a;
    else arreter(`argument en trop : ${a}\n  (un lien avec des « & » ? mets-le entre guillemets)`);
  }
  if (!o.entree) { console.log(AIDE); process.exit(1); }
  o.nombre = Math.floor(o.nombre);
  if (o.position > 100) arreter("--position va de 0 (à gauche) à 100 (à droite).");
  if (o.facecamTaille > 60) arreter("--facecam-taille va de 5 à 60 (en % de la largeur de l'image).");
  if (o.facecam) o.facecamZone = lireFacecam(o.facecam);
  if (o.apercu && !o.facecam) arreter("--apercu va avec --facecam (par exemple : --facecam haut-gauche --apercu).");
  if (o.apercu && o.liste) arreter("--apercu et --liste ne vont pas ensemble : --liste ne coupe rien.");
  if (o.avance >= o.duree) {
    arreter(`--avance (${o.avance} s) doit être plus petit que --duree (${o.duree} s), sinon le clip s'arrête avant le moment.`);
  }
  if (o.vod && o.telecharger) arreter("choisis soit --vod (vidéo déjà téléchargée), soit --telecharger.");
  return o;
}

// Un lien de VOD Twitch (ou juste son numéro) → le numéro de la VOD.
function idTwitch(entree) {
  const m = String(entree).match(/twitch\.tv\/(?:[^/?#]+\/)?(?:videos|v)\/(\d+)/i)
    || String(entree).match(/^v?(\d{6,})$/);
  return m ? m[1] : null;
}

// Un lien qui n'est pas une VOD Twitch : on explique quoi donner à la place.
function lienPasVod(entree) {
  if (/clips\.twitch\.tv|twitch\.tv\/[^/?#]+\/clip\//i.test(entree)) {
    return "c'est le lien d'un clip. Il faut le lien de la VOD (la vidéo entière du live) :\n  sur la chaîne, onglet Vidéos, clique sur le live passé et copie son lien (twitch.tv/videos/…).";
  }
  if (/twitch\.tv/i.test(entree)) {
    return "c'est le lien d'une chaîne, pas d'une VOD. Sur la chaîne, onglet Vidéos, clique sur le live\n  passé et copie son lien (twitch.tv/videos/…).";
  }
  if (/^https?:\/\//i.test(entree)) return "seuls les lives Twitch sont pris en charge (un lien twitch.tv/videos/…).";
  return null;
}

// ---------- Lecture du chat ----------

// Le chat d'un très gros live peut dépasser 500 Mo : on le lit par morceaux,
// en ne gardant que ce qui sert (le temps, l'auteur et le texte de chaque
// message), au lieu de tout charger d'un coup.
const CHAINE = '"((?:[^"\\\\]|\\\\.)*)"';
const NOMBRE = "(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?=[\\s,}\\]])";
const RE_CHAMPS = new RegExp([
  `"content_offset_seconds":\\s*${NOMBRE}`, // 1
  `"name":\\s*${CHAINE}`, // 2
  `"body":\\s*${CHAINE}`, // 3
  `"text":\\s*${CHAINE},\\s*"emoticon":\\s*(null|\\{)`, // 4, 5
  `"start":\\s*${NOMBRE}`, // 6
  `"id":\\s*"(\\d+)"`, // 7
  `"title":\\s*${CHAINE}`, // 8
  `"(comments|embeddedData|emotes)":`, // 9
].join("|"), "g");

function dechiffrer(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s; }
}

async function lireChat(chemin) {
  if (!existsSync(chemin)) throw new ErreurChat(`fichier introuvable : ${chemin}`);
  if (statSync(chemin).isDirectory()) throw new ErreurChat(`c'est un dossier, pas un fichier de chat : ${chemin}`);
  if (statSync(chemin).size === 0) throw new ErreurChat("ce fichier de chat est vide (téléchargement interrompu ?).");

  // Un .gz se reconnaît à ses deux premiers octets.
  const premiers = await new Promise((ok, ko) => {
    const f = createReadStream(chemin, { start: 0, end: 1 });
    const morceaux = [];
    f.on("data", (b) => morceaux.push(b)).on("end", () => ok(Buffer.concat(morceaux))).on("error", ko);
  });
  let flux = createReadStream(chemin, { highWaterMark: 1 << 20 });
  if (premiers[0] === 0x1f && premiers[1] === 0x8b) flux = flux.pipe(createGunzip());

  const messages = [];
  let ignores = 0;
  let zone = "debut"; // puis "comments", puis "fin"
  const infos = { chaine: null, idVideo: null, titre: null, debutVideo: 0, debutVu: false };
  let cur = null;
  const finir = () => {
    if (!cur) return;
    const texte = cur.body ?? cur.morceaux.join("");
    // Les bots, les commandes (« !discord », « !clip »…) et les annonces
    // d'abonnement ne sont pas des réactions.
    if (estBot(cur.auteur) || texte.trimStart().startsWith("!") || RE_ANNONCE.test(texte)) ignores++;
    else if (cur.t >= 0) messages.push({ t: cur.t, texte, auteur: cur.auteur, emotes: cur.emotes > 0 && !cur.texteLibre });
    cur = null;
  };

  let reste = "";
  let debutVerifie = false;
  let fin = ""; // les derniers caractères du fichier
  const traiter = (bout, dernier) => {
    if (!debutVerifie && bout.trim()) {
      // Un chat JSON commence par « { ». Sinon (une vidéo, une page web…), on s'arrête tout de suite.
      debutVerifie = true;
      if (bout.replace(/^﻿/, "").trimStart()[0] !== "{") {
        const video = [".mp4", ".mkv", ".ts", ".mov", ".m4a", ".webm"].includes(extname(chemin).toLowerCase());
        throw new ErreurChat(video
          ? "c'est une vidéo, pas un chat : donne d'abord le chat.json, puis la vidéo après --vod."
          : "ce fichier n'est pas un chat exporté en JSON par TwitchDownloader.");
      }
    }
    fin = (fin + bout).slice(-64);
    const s = reste + bout;
    RE_CHAMPS.lastIndex = 0;
    let finDerniere = 0;
    let m;
    while (zone !== "fin" && (m = RE_CHAMPS.exec(s)) !== null) {
      finDerniere = RE_CHAMPS.lastIndex;
      if (m[9] !== undefined) {
        if (m[9] === "comments" && zone === "debut") zone = "comments";
        else if (m[9] !== "comments" && zone === "comments") { finir(); zone = "fin"; }
        continue;
      }
      if (zone === "debut") { // l'en-tête : la chaîne, puis la vidéo
        if (m[2] !== undefined && infos.chaine === null) infos.chaine = dechiffrer(m[2]);
        else if (m[7] !== undefined && infos.idVideo === null) infos.idVideo = m[7];
        else if (m[8] !== undefined && infos.titre === null) infos.titre = dechiffrer(m[8]);
        else if (m[6] !== undefined && !infos.debutVu) { infos.debutVideo = Number(m[6]) || 0; infos.debutVu = true; }
        continue;
      }
      if (m[1] !== undefined) { // un nouveau message commence
        finir();
        cur = { t: Number(m[1]), auteur: "", body: null, morceaux: [], emotes: 0, texteLibre: false };
      } else if (!cur) continue;
      else if (m[2] !== undefined) { if (!cur.auteur) cur.auteur = dechiffrer(m[2]).toLowerCase(); }
      else if (m[3] !== undefined) { if (cur.body === null) cur.body = dechiffrer(m[3]); }
      else if (m[4] !== undefined) {
        const t = dechiffrer(m[4]);
        cur.morceaux.push(t);
        if (m[5] === "{") cur.emotes++;
        else if (t.trim()) cur.texteLibre = true;
      }
    }
    // On garde la fin du morceau, qui peut contenir un champ coupé en deux.
    reste = dernier ? "" : s.slice(Math.max(finDerniere, s.length - 65536));
  };

  const decodeur = new StringDecoder("utf8");
  try {
    for await (const bloc of flux) traiter(decodeur.write(bloc), false);
  } catch (e) {
    if (e instanceof ErreurChat) { flux.destroy(); throw e; }
    if (e.code === "Z_DATA_ERROR" || e.code === "Z_BUF_ERROR") throw new ErreurChat("ce fichier .gz est abîmé ou incomplet : retélécharge le chat.");
    throw new ErreurChat(`lecture impossible (${e.message}).`);
  }
  traiter(decodeur.end(), true);
  finir();

  if (zone === "debut") {
    throw new ErreurChat("pas de liste « comments » dans ce fichier : ce n'est pas un chat exporté en JSON par TwitchDownloader.");
  }
  // Un chat complet se termine par « ] » puis « } » (ou par ses données d'emotes).
  if (zone === "comments" && !/\]\s*\}\s*$/.test(fin)) {
    throw new ErreurChat("ce chat est incomplet (téléchargement interrompu ?) : retélécharge-le.");
  }
  if (messages.length === 0) throw new ErreurChat("le chat est vide.");
  messages.sort((a, b) => a.t - b.t);
  return { messages, ignores, ...infos };
}

// ---------- Ce que dit le chat ----------

function motHype(mot) {
  if (MOTS_HYPE.has(mot)) return true;
  for (const m of MOTIFS_REPETES) {
    if (mot.length > m.length && mot.length % m.length === 0 && m.repeat(mot.length / m.length) === mot) return true;
  }
  return false;
}

function estHype(texte) {
  if (RE_DONS.test(texte)) return false;
  const bas = texte.toLowerCase();
  const mots = bas.split(/[^\p{L}\p{N}]+/u);
  for (const mot of mots) {
    if (!mot) continue;
    // « mdrrr », « ptdrr », « looool » : on retire les lettres en double.
    const court = mot.replace(/(.)\1+/gu, "$1");
    if (motHype(mot) || motHype(court)) return true;
    if (CRIS_ETIRES.has(court) && /(.)\1\1/u.test(mot)) return true;
  }
  const phrase = " " + mots.filter(Boolean).join(" ") + " ";
  const phraseCourte = phrase.replace(/(.)\1+/gu, "$1");
  if (EXPRESSIONS_HYPE.some((e) => phrase.includes(" " + e + " ") || phraseCourte.includes(" " + e + " "))) return true;
  return EMOJIS_HYPE.some((e) => texte.includes(e));
}

// Un message court (3 mots au plus), ramené à sa forme simple (« Ouiiii » → « oui ») :
// une réponse typique d'un vote.
function formeCourte(texte) {
  const mots = texte.toLowerCase().replace(/@\S+/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (mots.length === 0 || mots.length > 3) return null;
  const f = mots.join(" ").replace(/(.)\1+/gu, "$1");
  return f.length <= 30 ? f : null;
}

function motsFrequents(textes, n = 3) {
  const freq = new Map();
  for (const t of textes) {
    const mots = t.toLowerCase().replace(/@\S+/g, " ")
      .split(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/u)
      // « ouiiii » → « oui », « 🔥🔥🔥 » → « 🔥 », mais « bonne » et « hello » restent intacts.
      .map((w) => w.replace(/(\p{Extended_Pictographic})\1+/gu, "$1").replace(/(.)\1{2,}/gu, "$1"))
      .filter((w) => w && !MOTS_VIDES.has(w) && (w.length > 1 || /\p{Extended_Pictographic}/u.test(w)));
    for (const w of new Set(mots)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// ---------- Détection des moments ----------

function mediane(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function trouverMoments(messages, o) {
  const t0 = Math.floor(messages[0].t / o.fenetre) * o.fenetre;
  const nb = Math.floor((messages[messages.length - 1].t - t0) / o.fenetre) + 1;
  if (nb > 5_000_000) arreter("les temps de ce chat sont incohérents (ou --fenetre est trop petite).");
  const compte = new Array(nb).fill(0);
  const score = new Array(nb).fill(0);
  const nbHype = new Array(nb).fill(0);
  const nbCourts = new Array(nb).fill(0);
  const formes = Array.from({ length: nb }, () => null);
  const textes = Array.from({ length: nb }, () => []);
  let tranche = -1;
  let parAuteur = new Map();
  for (const m of messages) { // les messages sont triés par temps
    const i = Math.floor((m.t - t0) / o.fenetre);
    if (i !== tranche) { tranche = i; parAuteur = new Map(); }
    // Une même personne compte au plus 2 messages par tranche : un spammeur seul ne fait pas un pic.
    const deja = parAuteur.get(m.auteur) ?? 0;
    parAuteur.set(m.auteur, deja + 1);
    if (m.auteur && deja >= 2) continue;
    compte[i] += 1;
    const hype = estHype(m.texte);
    score[i] += hype ? 1.5 : 1;
    if (textes[i].length < 400) textes[i].push(m.texte); // assez pour la colonne « Le chat dit »
    if (hype) nbHype[i] += 1;
    else if (!m.emotes) {
      const f = formeCourte(m.texte);
      if (f) {
        nbCourts[i] += 1;
        formes[i] ??= new Map();
        formes[i].set(f, (formes[i].get(f) ?? 0) + 1);
      }
    }
  }

  // Les votes : quand le streamer pose une question, le chat répond en masse
  // « oui », « non », un prénom… Ça fait un pic, mais pas un clip. Mesuré sur
  // de vrais chats, un vote a trois signes : presque aucune réaction (moins de
  // 12 % de messages « hype », contre 25 % et plus pour un vrai moment), surtout
  // des réponses courtes (plus de 55 %), et ce sont souvent les mêmes (les 3
  // réponses les plus fréquentes font au moins 25 % des messages, contre 15 % au
  // plus pour un vrai moment). Ses réponses ne comptent alors plus qu'à 20 %.
  const vote = new Array(nb).fill(false);
  for (let i = 0; i < nb; i++) {
    if (compte[i] < o.min || !formes[i]) continue;
    const top3 = [...formes[i].values()].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    if (nbHype[i] / compte[i] < 0.12 && nbCourts[i] / compte[i] >= 0.55 && top3 / compte[i] >= 0.25) {
      vote[i] = true;
      if (!o.votes) score[i] -= 0.8 * nbCourts[i];
    }
  }

  // Le « rythme normal » : la médiane du chat sur 5 minutes de chaque côté.
  // Elle suit le live (un chat plus calme au début, plus actif à la fin) et un
  // pic isolé ne la fait presque pas bouger. Pareil pour les réactions.
  const rayon = Math.max(3, Math.round(300 / o.fenetre));
  const autour = (serie, i) => serie.slice(Math.max(0, i - rayon), Math.min(nb, i + rayon + 1));
  const normal = score.map((_, i) => Math.max(1, mediane(autour(score, i))));
  const normalHype = nbHype.map((_, i) => Math.max(1, mediane(autour(nbHype, i))));
  const normalCompte = compte.map((_, i) => mediane(autour(compte, i)));

  // Un très gros chat touche le plafond de TwitchDownloader (15 messages par
  // seconde) : son volume ne peut plus tripler. Ce qui change, c'est sa nature :
  // pendant un moment drôle, la moitié du chat rit. Sur ces passages saturés,
  // il suffit que les réactions doublent.
  const sature = normalCompte.map((n) => n >= 0.5 * PLAFOND_PAR_SECONDE * o.fenetre);
  const partSaturee = sature.filter(Boolean).length / nb;

  // Un pic : --seuil fois plus de messages que d'habitude, ou --seuil fois plus
  // de réactions (avec au moins 10 réactions).
  const seuilReactions = (i) => (sature[i] ? Math.min(o.seuil, 2) : o.seuil);
  const estCandidat = (i) => compte[i] >= o.min && (score[i] / normal[i] >= o.seuil
    || (nbHype[i] / normalHype[i] >= seuilReactions(i) && nbHype[i] >= Math.min(10, o.min)));
  const candidats = [];
  for (let i = 0; i < nb; i++) {
    if (!estCandidat(i)) continue;
    const ratio = score[i] / normal[i];
    const ratioHype = nbHype[i] / normalHype[i];
    const parReactions = ratioHype >= seuilReactions(i) && nbHype[i] >= Math.min(10, o.min);
    // En saturé, un doublement des réactions vaut un triplement ailleurs.
    const force = Math.max(ratio, parReactions ? ratioHype * (o.seuil / seuilReactions(i)) : 0);
    candidats.push({ i, t: t0 + i * o.fenetre, compte: compte[i], ratio, ratioHype, force, vote: vote[i] });
  }

  // Une réaction dure souvent 20 ou 30 secondes : les tranches de pic qui se
  // suivent (à une tranche près) forment un seul moment, et on n'en garde que
  // la plus forte.
  candidats.sort((a, b) => b.force - a.force || b.compte - a.compte);
  const pris = new Set();
  const gardes = [];
  for (const c of candidats) {
    if (gardes.length >= o.nombre) break;
    if (pris.has(c.i)) continue;
    for (const sens of [-1, 1]) {
      let j = c.i;
      while (estCandidat(j + sens) || estCandidat(j + 2 * sens)) { j += sens; pris.add(j); }
    }
    pris.add(c.i);
    // Le clip part de quand le chat commence à réagir : on remonte jusqu'à 2
    // tranches tant qu'elles sont déjà fortes (60 % du pic ou plus).
    let ancre = c.i;
    while (ancre > c.i - 2 && ancre > 0 && score[ancre - 1] >= 0.6 * score[c.i]) ancre--;
    const debutAbs = Math.max(0, t0 + ancre * o.fenetre - o.avance);
    const finAbs = Math.max(debutAbs + o.duree, c.t);
    if (gardes.some((g) => debutAbs < g.finAbs && finAbs > g.debutAbs)) continue; // pas de clips qui se chevauchent
    gardes.push({ ...c, debutAbs, finAbs, mots: motsFrequents(textes[c.i]) });
  }
  return { moments: gardes.sort((a, b) => a.t - b.t), nbTranches: nb, partSaturee };
}

// ---------- TwitchDownloader ----------

function trouverTwitchDownloader(chemin) {
  const nom = process.platform === "win32" ? "TwitchDownloaderCLI.exe" : "TwitchDownloaderCLI";
  if (chemin) {
    let p = resolve(chemin);
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, nom);
    if (!existsSync(p)) arreter(`TwitchDownloaderCLI introuvable : ${p}`);
    return p;
  }
  for (const dossier of [process.cwd(), ICI]) {
    const p = join(dossier, nom);
    if (existsSync(p) && statSync(p).isFile()) return p;
    // « Extraire tout » sur Windows le range souvent dans son propre dossier.
    for (const sous of readdirSync(dossier)) {
      if (!/^TwitchDownloaderCLI/i.test(sous)) continue;
      const q = join(dossier, sous, nom);
      if (existsSync(q) && statSync(q).isFile()) return q;
    }
  }
  // Sinon, dans le PATH (TwitchDownloaderCLI répond à --version avec le code 1).
  const r = spawnSync(nom, ["--version"], { encoding: "utf8" });
  return !r.error && r.signal === null && /TwitchDownloader/i.test(`${r.stdout}${r.stderr}`) ? nom : null;
}

// Traduit les erreurs de TwitchDownloaderCLI. « grave » = inutile d'essayer les autres moments.
function erreurTwitch(sortie, code) {
  if (/Insufficient access|OAuth may be required/i.test(sortie)) {
    return { grave: true, message: "cette VOD est réservée aux abonnés : TwitchDownloader ne peut pas la lire. Choisis une VOD publique." };
  }
  if (/ERROR\(S\):|bad format|is unknown|not recognized/i.test(sortie)) {
    return { grave: true, message: "TwitchDownloaderCLI n'a pas compris la commande : mets-le à jour (version 1.56 ou plus récente)." };
  }
  if (/Invalid VOD|deleted\/expired/i.test(sortie)) {
    return { grave: true, message: "cette VOD n'existe plus (supprimée, expirée, ou lien faux). Les VOD ne restent que quelques jours ou semaines sur Twitch." };
  }
  if (/Unknown quality/i.test(sortie)) {
    return { grave: true, message: "cette qualité n'existe pas pour cette VOD : essaie --qualite 1080p60, 720p60 ou 480p30." };
  }
  if (/HttpRequestException|SocketException|Connection refused|nodename nor servname|No such host|Name or service not known|timed out|network/i.test(sortie)) {
    return { grave: true, message: "pas de connexion à Twitch : vérifie internet, puis relance." };
  }
  const cause = sortie.match(/Unhandled exception\.\s*(?:[\w.]+:\s*)?(?:One or more errors occurred\.\s*\()?(.+?)\)?\s*$/m)?.[1]
    ?? sortie.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("at ") && !l.startsWith("---")).pop();
  return { grave: false, message: cause || `TwitchDownloaderCLI a échoué (code ${code}).` };
}

function lancerTwitch(td, args, afficher) {
  // --collision n'existe que pour les téléchargements (pas pour « info »).
  const options = args[0].endsWith("download") ? ["--collision", "Overwrite", "--banner=false"] : ["--banner=false"];
  const r = spawnSync(td, [...args, ...options], {
    encoding: "utf8",
    stdio: afficher ? ["ignore", "inherit", "pipe"] : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error?.code === "EACCES") arreter(`TwitchDownloaderCLI n'a pas le droit de se lancer. Tape : chmod +x ${entreGuillemets(td)}`);
  if (r.error) arreter(`impossible de lancer TwitchDownloaderCLI (${r.error.message}).`);
  if (r.signal === "SIGKILL" && process.platform === "darwin") {
    arreter(`macOS a bloqué TwitchDownloaderCLI. Tape : xattr -c ${entreGuillemets(td)}\n  (ou Réglages Système › Confidentialité et sécurité › « Ouvrir quand même »), puis relance.`);
  }
  if (r.signal === "SIGINT" || r.signal === "SIGTERM" || r.status === 130) {
    const err = new Error("arrêté (Ctrl+C).");
    err.grave = true;
    throw err;
  }
  if (r.status !== 0) {
    const e = erreurTwitch(`${r.stdout ?? ""}\n${r.stderr ?? ""}`, r.status);
    const err = new Error(e.message);
    err.grave = e.grave;
    throw err;
  }
}

// Vérifie en une seconde que la VOD existe et se lit, avant de tout télécharger.
function verifierVod(td, id) {
  try { lancerTwitch(td, ["info", "--id", id], false); } catch (e) { arreter(e.message); }
}

// ---------- Découpe avec ffmpeg ----------

function verifierFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    arreter("ffmpeg est introuvable. Mac : installe Homebrew (https://brew.sh), puis brew install ffmpeg.\n  Windows : winget install Gyan.FFmpeg. Ouvre ensuite un nouveau terminal.");
  }
}

function dureeVideo(chemin) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", chemin], { encoding: "utf8" });
  const d = Number(r.stdout?.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function dimensionsVideo(chemin) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "csv=p=0", chemin], { encoding: "utf8" });
  const [l, h] = (r.stdout ?? "").trim().split(",").map(Number);
  return l > 0 && h > 0 ? { l, h } : null;
}

// Où est la face cam, en pixels, dans une vidéo de l × h pixels.
function zoneFacecam(o, l, h) {
  const f = o.facecamZone;
  if (f.coin) {
    const largeur = Math.round(l * o.facecamTaille / 100);
    const hauteur = Math.min(h, Math.round(largeur * 9 / 16)); // une face cam est le plus souvent en 16:9
    return { x: f.coin[0] ? l - largeur : 0, y: f.coin[1] ? h - hauteur : 0, l: largeur, h: hauteur };
  }
  const z = { x: Math.round(l * f.x / 100), y: Math.round(h * f.y / 100), l: Math.round(l * f.l / 100), h: Math.round(h * f.h / 100) };
  return { ...z, l: Math.min(z.l, l - z.x), h: Math.min(z.h, h - z.y) };
}

// Où commence (en pixels, depuis la gauche) la partie du jeu gardée en haut. Sans --position,
// on centre, mais si la face cam déborde dans la partie gardée (elle serait en double),
// on décale juste assez pour la laisser dehors. Avec --position, on obéit.
function positionJeu(o, z, d, jeuH) {
  const largeur = Math.min(d.l, d.h * 1080 / jeuH);
  const libre = Math.max(0, d.l - largeur);
  let x = libre * o.position / 100;
  if (!o.positionDonnee && z.x < x + largeur && z.x + z.l > x) {
    const aDroite = Math.min(libre, z.x + z.l + 2), aGauche = z.x - largeur - 2;
    const milieuCam = z.x + z.l / 2;
    const choix = milieuCam < d.l / 2 ? [aDroite, aGauche] : [aGauche, aDroite];
    const ok = choix.find((c) => c >= 0 && c <= libre && (z.x >= c + largeur || z.x + z.l <= c));
    if (ok !== undefined) x = ok;
  }
  return Math.round(x);
}

// Le jeu en haut, la face cam en bas : la face cam prend toute la largeur (1080) et la
// hauteur qui garde ses proportions (entre 540 et 960), le jeu prend le reste de l'écran.
function filtreFacecam(video, o) {
  const d = dimensionsVideo(video);
  if (!d) throw new Error("impossible de lire la taille de la vidéo");
  const z = zoneFacecam(o, d.l, d.h);
  const camH = Math.min(960, Math.max(540, Math.round(1080 * z.h / z.l / 2) * 2));
  const jeuH = 1920 - camH;
  const xJeu = positionJeu(o, z, d, jeuH);
  const cam = `[c]crop=${z.l}:${z.h}:${z.x}:${z.y},scale=1080:${camH}:force_original_aspect_ratio=increase,crop=1080:${camH},setsar=1[cam];`;
  const jeu = o.flou
    ? `[0:v]split=3[a][b][c];[a]scale=1080:${jeuH}:force_original_aspect_ratio=increase,crop=1080:${jeuH},boxblur=24:2[fond];` +
      "[b]scale=1080:-2[img];[fond][img]overlay=(W-w)/2:(H-h)/2[jeu];"
    : `[0:v]split=2[a][c];[a]crop=w='min(iw,ih*1080/${jeuH})':h='min(ih,iw*${jeuH}/1080)':x=${xJeu}:y='(ih-oh)/2',` +
      `scale=1080:${jeuH},setsar=1[jeu];`;
  return ["-filter_complex", `${jeu}${cam}[jeu][cam]vstack=inputs=2,setsar=1,format=yuv420p[v]`, "-map", "[v]", "-map", "0:a?"];
}

// Une image de la vidéo avec un cadre rouge autour de la face cam : pour vérifier le cadrage.
function apercuFacecam(video, instant, o) {
  const d = dimensionsVideo(video);
  if (!d) throw new Error("impossible de lire la taille de la vidéo");
  const z = zoneFacecam(o, d.l, d.h);
  const chemin = join(o.dossier, "apercu-facecam.png");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", Math.max(0, instant).toFixed(3), "-i", video,
    "-frames:v", "1", "-vf", `drawbox=x=${z.x}:y=${z.y}:w=${z.l}:h=${z.h}:color=red:t=3`, chemin], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(chemin)) throw new Error((r.stderr ?? "").trim().split("\n").pop() || "ffmpeg a échoué");
  console.log(`  Face cam : le cadre rouge est dans ${chemin} (ouvre l'image pour vérifier).`);
  if (z.l < 540) {
    console.log(`  Attention : la face cam ne fait que ${z.l} px de large dans cette vidéo, elle sera un peu floue. ${o.vod ? "Prends une vidéo de meilleure qualité." : "Garde la qualité 1080p60 (--qualite)."}`);
  }
}

function couper(video, debut, duree, sortie, o) {
  const x = (o.position / 100).toFixed(3);
  const filtre = o.facecam ? filtreFacecam(video, o) : o.flou
    ? ["-filter_complex",
      "[0:v]split[a][b];" +
      "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[fond];" +
      "[b]scale=1080:-2[img];[fond][img]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]",
      "-map", "[v]", "-map", "0:a?"]
    : ["-vf", `crop='min(iw,ih*9/16)':ih:'(iw-ow)*${x}':0,scale=1080:1920,setsar=1,format=yuv420p`,
      "-map", "0:v:0", "-map", "0:a?"];
  const provisoire = sortie.replace(/\.mp4$/, ".partiel.mp4");
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    ...(debut > 0 ? ["-ss", debut.toFixed(3)] : []), "-i", video, "-t", duree.toFixed(3),
    ...filtre, "-map_chapters", "-1", // pas de piste de chapitres héritée de Twitch
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", provisoire];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.signal) { if (existsSync(provisoire)) unlinkSync(provisoire); arreter("arrêté."); }
  if (r.status !== 0) {
    if (existsSync(provisoire)) unlinkSync(provisoire);
    throw new Error((r.stderr ?? "").trim().split("\n").pop() || "ffmpeg a échoué");
  }
  renameSync(provisoire, sortie);
}

// ---------- Programme ----------

// Ctrl+C : pendant un téléchargement ou une découpe, TwitchDownloader ou ffmpeg
// s'arrête, et l'outil efface ses fichiers provisoires avant de quitter.
process.on("SIGINT", () => process.exit(130));

const o = lireArguments(process.argv.slice(2));
const id = idTwitch(o.entree);
const depuisLien = id !== null && !existsSync(o.entree);
if (!depuisLien && !existsSync(o.entree)) {
  const pasVod = lienPasVod(o.entree);
  if (pasVod) arreter(pasVod);
}
const decoupe = !o.liste && (depuisLien || o.telecharger || o.vod);
if (decoupe) verifierFfmpeg(); // avant les longs téléchargements, pas après
let td = null;
let cheminChat = o.entree;
let chat = null;

if (depuisLien) {
  td = trouverTwitchDownloader(o.twitch);
  if (!td) {
    arreter("pour partir d'un lien Twitch, il faut TwitchDownloaderCLI : mets-le dans ce dossier,\n  ou indique où il est avec --twitch <chemin>. Téléchargement : https://github.com/lay295/TwitchDownloader/releases");
  }
  cheminChat = join(o.dossier, `chat-${id}.json`);
  if (existsSync(cheminChat)) {
    try {
      chat = await lireChat(cheminChat);
      console.log(`\nChat déjà téléchargé : ${cheminChat}`);
    } catch (e) {
      console.log(`\nLe chat déjà téléchargé est inutilisable (${e.message}) : je le retélécharge.`);
      unlinkSync(cheminChat);
    }
  }
  if (!chat) {
    verifierVod(td, id);
    mkdirSync(o.dossier, { recursive: true });
    console.log(`\nTéléchargement du chat de la VOD ${id} (quelques minutes pour un gros live)…`);
    // Écrit sous un nom provisoire : un téléchargement interrompu ne laisse pas un faux chat.
    const provisoire = join(o.dossier, `chat-${id}.partiel.json`);
    try {
      lancerTwitch(td, ["chatdownload", "--id", id, "-o", provisoire], true);
      renameSync(provisoire, cheminChat);
    } catch (e) {
      if (existsSync(provisoire)) unlinkSync(provisoire);
      arreter(e.message);
    }
  }
}

if (!chat) {
  try { chat = await lireChat(cheminChat); } catch (e) { arreter(e.message); }
}
const { moments, nbTranches, partSaturee } = trouverMoments(chat.messages, o);

console.log(`\nChat : ${chat.messages.length.toLocaleString("fr-FR")} messages` +
  (chat.ignores ? ` (+ ${chat.ignores.toLocaleString("fr-FR")} de bots, de commandes ou d'annonces, ignorés)` : "") +
  (chat.chaine ? ` · chaîne ${chat.chaine}` : "") + (chat.titre ? ` · « ${chat.titre} »` : ""));
console.log(`Analyse : ${nbTranches} tranches de ${o.fenetre} s. Un pic = au moins ${o.min} messages, et ${o.seuil}× plus de messages`);
console.log(`ou ${o.seuil}× plus de réactions (rires, wow, KEKW…) que d'habitude.`);
if (partSaturee >= 0.2) {
  console.log(`Chat très rapide : Twitch ne garde que ${PLAFOND_PAR_SECONDE} messages par seconde, donc sur ${Math.round(partSaturee * 100)} % du live`);
  console.log("les moments se repèrent surtout aux réactions (il suffit qu'elles doublent).");
}
console.log("");

if (moments.length === 0) {
  console.log("Aucun pic trouvé. Pour un petit chat calme, essaie --seuil 2 --min 8.\n");
  process.exit(0);
}

console.log(" #  Moment     Messages   × chat   × réactions   Le chat dit");
moments.forEach((m, k) => {
  console.log(
    `${String(k + 1).padStart(2)}  ${hms(m.t).padEnd(9)}  ${String(m.compte).padStart(8)}   ` +
    `${("×" + m.ratio.toFixed(1)).padEnd(7)}  ${("×" + m.ratioHype.toFixed(1)).padEnd(12)} ` +
    `${m.vote ? "(vote ?) " : ""}${m.mots.join(", ")}`);
});
if (moments.some((m) => m.vote)) {
  console.log("\n(vote ?) = le chat répond surtout la même chose (« oui », « non », un prénom…) :");
  console.log("le streamer a sans doute posé une question. Ces pics passent après les autres.");
}

const lignesCsv = ["numero;moment;debut_clip;fin_clip;messages;fois_plus_de_messages;fois_plus_de_reactions;vote;mots;lien_twitch"];
for (const [k, m] of moments.entries()) {
  m.lien = chat.idVideo ? `https://www.twitch.tv/videos/${chat.idVideo}?t=${hmsLien(m.debutAbs)}` : "";
  lignesCsv.push([k + 1, hms(m.t), hms(m.debutAbs), hms(m.finAbs), m.compte, m.ratio.toFixed(1),
    m.ratioHype.toFixed(1), m.vote ? "oui" : "non", m.mots.join(" ").replace(/;/g, ","), m.lien].join(";"));
}

if (chat.idVideo) {
  console.log("\nLiens pour vérifier sur Twitch (là où chaque clip commence) :");
  moments.forEach((m, k) => console.log(`${String(k + 1).padStart(2)}  ${m.lien}`));
}

if (!decoupe) {
  const e = entreGuillemets(o.entree);
  console.log("\nPour couper ces moments en clips verticaux :");
  if (depuisLien) console.log(`  node ${NOM_SCRIPT} ${e}      (sans --liste)`);
  else if (chat.idVideo) console.log(`  node ${NOM_SCRIPT} ${e} --telecharger      (télécharge seulement ces moments)`);
  console.log(`  node ${NOM_SCRIPT} ${entreGuillemets(cheminChat)} --vod <video.mp4>  (si tu as déjà la vidéo du live)\n`);
  process.exit(0);
}

mkdirSync(o.dossier, { recursive: true });
writeFileSync(join(o.dossier, "moments.csv"), lignesCsv.join("\n") + "\n");
const formatJeu = o.flou ? "fond flou" : o.position === 50 ? "plein écran 9:16" : `plein écran 9:16, cadré à ${o.position} %`;
const format = o.facecam ? `jeu en haut (${formatJeu.replace("plein écran 9:16", "recadré")}) + face cam en bas` : formatJeu;
let faits = 0;
let apercuSeul = false; // --apercu : on s'arrête après l'image du cadrage de la face cam

if (!o.vod) {
  if (!td) td = trouverTwitchDownloader(o.twitch);
  if (!td) arreter("--telecharger a besoin de TwitchDownloaderCLI : mets-le dans ce dossier, ou indique-le avec --twitch <chemin>.");
  if (!chat.idVideo) arreter("ce chat ne dit pas de quelle VOD il vient : télécharge la vidéo et utilise --vod.");
  if (!depuisLien) verifierVod(td, chat.idVideo);
  console.log(`\nTéléchargement ${moments.length > 1 ? `des ${moments.length} moments` : "du moment"} (${o.qualite}) et découpe (${format}) dans « ${o.dossier} »…`);
  for (const [k, m] of moments.entries()) {
    const nom = `clip-${String(k + 1).padStart(2, "0")}-${hmsFichier(m.t)}.mp4`;
    const morceau = join(o.dossier, `.morceau-${String(k + 1).padStart(2, "0")}.mp4`);
    // Twitch place une image clé toutes les 2 secondes : on télécharge un peu
    // plus large, en secondes entières, et on coupe pile au bon endroit ensuite.
    const b = Math.max(0, Math.floor((m.debutAbs - 4) / 2) * 2);
    const e = Math.ceil(m.finAbs);
    try {
      lancerTwitch(td, ["videodownload", "--id", chat.idVideo, "-b", `${b}s`, "-e", `${e}s`,
        "-q", o.qualite, "-o", morceau, "--log-level", "Error"], false);
      const longueur = dureeVideo(morceau);
      const decalage = m.debutAbs - b;
      const duree = Math.min(m.finAbs - m.debutAbs, longueur ? longueur - decalage : Infinity);
      if (o.facecam && k === 0) {
        apercuFacecam(morceau, decalage + Math.min(5, duree / 2), o);
        if (o.apercu) { apercuSeul = true; break; }
      }
      couper(morceau, decalage, duree, join(o.dossier, nom), o);
      faits++;
      console.log(`  ✔ ${nom}  (live ${hms(m.debutAbs)} → ${hms(m.debutAbs + duree)})`);
    } catch (err) {
      console.log(`  ✖ ${nom} : ${err.message.split("\n")[0]}`);
      if (err.grave) break; // inutile d'essayer les autres moments
    } finally {
      if (existsSync(morceau)) unlinkSync(morceau);
    }
  }
} else {
  if (!existsSync(o.vod)) arreter(`vidéo introuvable : ${o.vod}`);
  // Les temps du chat partent du début de la VOD. Si le chat et la vidéo ont été
  // coupés pareil avec TwitchDownloader (option -b), la vidéo commence à
  // video.start : on décale pour tomber au bon endroit dans le fichier.
  const decalage = o.vodComplete ? 0 : chat.debutVideo;
  const longueur = dureeVideo(o.vod);
  console.log(`\nDécoupe de ${pluriel(moments.length, "clip")} (${format}) dans « ${o.dossier} »…`);
  for (const [k, m] of moments.entries()) {
    const debut = Math.max(0, m.debutAbs - decalage);
    const nom = `clip-${String(k + 1).padStart(2, "0")}-${hmsFichier(m.t)}.mp4`;
    if (longueur && debut >= longueur) {
      console.log(`  ✖ ${nom} : hors de la vidéo (elle dure ${hms(longueur)}). Vidéo entière mais chat coupé ? Ajoute --vod-complete.`);
      continue;
    }
    const duree = Math.min(m.finAbs - m.debutAbs, longueur ? longueur - debut : Infinity);
    try {
      if (o.facecam && k === 0) {
        apercuFacecam(o.vod, debut + Math.min(5, duree / 2), o);
        if (o.apercu) { apercuSeul = true; break; }
      }
      couper(o.vod, debut, duree, join(o.dossier, nom), o);
      faits++;
      console.log(`  ✔ ${nom}  (live ${hms(m.debutAbs)} → ${hms(m.debutAbs + duree)})`);
    } catch (err) {
      console.log(`  ✖ ${nom} : ${err.message.split("\n")[0]}`);
    }
  }
}

if (apercuSeul) {
  console.log(`\nOuvre ${join(o.dossier, "apercu-facecam.png")} : le cadre rouge doit entourer la face cam.`);
  console.log("Pas bon ? Donne ses coordonnées en % de l'image : --facecam x,y,largeur,hauteur (exemple : --facecam 2,2,30,30).");
  console.log("C'est bon ? Relance la même commande sans --apercu pour couper les clips.\n");
  process.exit(0);
}
console.log(`\n${pluriel(faits, "clip")} prêt${faits > 1 ? "s" : ""}. La liste des moments est dans ${join(o.dossier, "moments.csv")}.`);
if (faits > 0) {
  if (o.facecam) console.log("Face cam mal cadrée ? Regarde apercu-facecam.png, puis relance avec --facecam x,y,largeur,hauteur (en % de l'image).");
  else if (!o.flou) console.log("Une facecam dans un coin ? Relance avec --facecam haut-gauche (le jeu en haut, la face cam en bas). Plusieurs caméras ? --flou ou --position 0 / 100.");
  console.log("Ajoute les sous-titres avec OpenShorts (ou ton monteur), et ne clippe que les streamers qui l'autorisent.\n");
}
process.exit(faits > 0 ? 0 : 1);
