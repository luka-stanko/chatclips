// Tests de chat-clips : node test/test.mjs (ou npm test)
// Fabrique un faux live (chat au format TwitchDownloader + vidéo de test si
// ffmpeg est là), lance l'outil et vérifie ce qu'il trouve.

import { writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUTIL = join(dirname(fileURLToPath(import.meta.url)), "..", "chat-clips.mjs");
const dossier = mkdtempSync(join(tmpdir(), "chat-clips-test-"));
let echecs = 0;
const verifier = (ok, nom, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${nom}${!ok && detail ? `\n    ${detail}` : ""}`);
  if (!ok) echecs++;
};
const lancer = (...args) => {
  const r = spawnSync(process.execPath, [OUTIL, ...args], { cwd: dossier, encoding: "utf8" });
  return { code: r.status, sortie: `${r.stdout}${r.stderr}` };
};
const momentsListes = (sortie) => [...sortie.matchAll(/^\s*\d+\s+(\d+:\d\d:\d\d)\s/gm)].map((m) => m[1]);

// ---------- Faux live de 30 minutes ----------
let graine = 42;
const hasard = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
const banal = ["salut", "il est où le garage", "c'est quoi ce build", "bonne soirée", "ça farm", "t'as vu la voiture"];
const hype = ["PTDR", "KEKW", "CLIP ÇA", "NON MAIS 💀", "mdrrr", "OMEGALUL", "no way", "JPP 😂", "LULLUL"];
const commentaires = [];
let n = 0;
const ajouter = (t, texte, auteur = `viewer${n % 400}`) => {
  n++;
  commentaires.push({
    _id: String(n), created_at: "2026-11-14T20:00:00Z", content_offset_seconds: +t.toFixed(3),
    commenter: { display_name: auteur, _id: String(n), name: auteur.toLowerCase() },
    message: { body: texte, bits_spent: 0, fragments: [{ text: texte, emoticon: null }], user_badges: [], emoticons: [] },
  });
};
for (let t = 0; t < 1800; t += 0.1) if (hasard() < (0.3 + 0.5 * t / 1800) * 0.1) ajouter(t, banal[Math.floor(hasard() * banal.length)]);
const pic = (t, nombre, duree) => {
  for (let k = 0; k < nombre; k++) ajouter(t + hasard() * duree, hype[Math.floor(hasard() * hype.length)], `fan${t}_${k}`);
};
pic(302, 250, 9); pic(752, 120, 9); pic(1203, 60, 9); pic(1631, 200, 9);
for (let k = 0; k < 150; k++) ajouter(1400 + hasard() * 9, k % 3 ? "oui" : "non", `votant${k}`); // un vote
for (let k = 0; k < 300; k++) ajouter(500 + hasard() * 9, "⛔ quelqu'un est éjecté 60 secondes", "Nightbot"); // un bot
for (let k = 0; k < 300; k++) ajouter(600 + hasard() * 9, "PTDR PTDR PTDR", "spammeur"); // une seule personne
ajouter(900, "NOWAY".repeat(100) + "S"); // un message piège pour l'ancienne détection
commentaires.sort((a, b) => a.content_offset_seconds - b.content_offset_seconds);
const racine = (debut, liste) => ({
  FileInfo: { Version: { Major: 1, Minor: 4, Patch: 0 } }, streamer: { name: "TestStreamer", login: "teststreamer", id: 1 },
  video: { title: "GTA RP jour 1", id: "2600000001", start: debut, end: 1800, length: 1800 }, comments: liste, embeddedData: null,
});
writeFileSync(join(dossier, "chat.json"), JSON.stringify(racine(0, commentaires)));
writeFileSync(join(dossier, "chat.json.gz"), gzipSync(JSON.stringify(racine(0, commentaires))));
writeFileSync(join(dossier, "chat-coupe.json"), JSON.stringify(racine(600, commentaires.filter((c) => c.content_offset_seconds >= 600))));

// ---------- Tests ----------
console.log(`Dossier de test : ${dossier}\n`);
const debut = Date.now();
const liste = lancer("chat.json", "--liste");
verifier(liste.code === 0, "l'outil lit un chat TwitchDownloader", liste.sortie);
verifier(Date.now() - debut < 15000, "un message de spam de 500 caractères ne bloque pas l'outil");
const trouves = momentsListes(liste.sortie);
const vrais = ["0:05:00", "0:12:30", "0:20:00", "0:27:10"];
verifier(vrais.every((t) => trouves.includes(t)), "les 4 vrais pics sont trouvés", `trouvés : ${trouves.join(", ")}`);
verifier(!trouves.includes("0:23:20") || /0:23:20.*\(vote \?\)/.test(liste.sortie),
  "le vote (« oui » / « non ») est signalé « (vote ?) »", liste.sortie);
const top4 = momentsListes(lancer("chat.json", "--liste", "--nombre", "4").sortie);
verifier(JSON.stringify(top4) === JSON.stringify(vrais), "le vote passe après les 4 vrais pics", `top 4 : ${top4.join(", ")}`);
verifier(!trouves.includes("0:08:20"), "les messages d'un bot sont ignorés");
verifier(!trouves.includes("0:10:00"), "un spammeur seul ne fait pas un pic");
verifier(/300 de bots, de commandes ou d'annonces, ignorés/.test(liste.sortie), "le nombre de messages de bots ignorés est affiché");
verifier(/twitch\.tv\/videos\/2600000001\?t=0h4m40s/.test(liste.sortie), "le lien Twitch pointe 20 s avant le premier pic");

const votes = lancer("chat.json", "--liste", "--votes", "--nombre", "10");
verifier(/0:23:20.*\(vote \?\)/.test(votes.sortie), "avec --votes, le vote apparaît et il est signalé « (vote ?) »");

const rires = [["jajajaja", "espagnol"], ["kkkkkk", "portugais"], ["ㅋㅋㅋㅋ", "coréen"], ["хахаха", "russe"], ["草", "japonais"]];
writeFileSync(join(dossier, "rires.json"), JSON.stringify(racine(0, rires.map(([texte], k) => ({
  content_offset_seconds: k, commenter: { name: `r${k}` }, message: { body: texte, fragments: [{ text: texte, emoticon: null }] },
})))));
const outilSource = (await import("node:fs")).readFileSync(OUTIL, "utf8");
const code = outilSource.slice(outilSource.indexOf("const MOTS_HYPE"), outilSource.indexOf("const ICI")) +
  outilSource.slice(outilSource.indexOf("function motHype"), outilSource.indexOf("// ---------- Détection")) +
  "\nexport { estHype };";
const { estHype } = await import("data:text/javascript," + encodeURIComponent(code));
for (const [texte, langue] of rires) verifier(estHype(texte), `un rire en ${langue} (« ${texte} ») compte comme une réaction`);

// Un très gros chat saturé (mode lent) : le nombre de messages ne bouge pas,
// mais à 0:15:00 le chat se met à rire. Et des annonces d'abonnement partout.
const sature = [];
let m = 0;
for (let t = 0; t < 1800; t += 0.1) {
  const rire = t >= 900 && t < 910;
  sature.push({ content_offset_seconds: +t.toFixed(2), commenter: { name: `u${m % 5000}` },
    message: { body: rire && m % 10 < 6 ? "LMAOOO" : banal[m % banal.length] } });
  if (m % 40 === 0) sature.push({ content_offset_seconds: +t.toFixed(2), commenter: { name: `s${m}` },
    message: { body: `s${m} subscribed at Tier 1. They've subscribed for 3 months!` } });
  m++;
}
writeFileSync(join(dossier, "sature.json"), JSON.stringify(racine(0, sature)));
const sat = lancer("sature.json", "--liste");
verifier(momentsListes(sat.sortie)[0] === "0:15:00", "chat saturé : le pic de rires est trouvé même si le nombre de messages ne bouge pas", sat.sortie);
const nbAnnonces = sature.filter((c) => c.message.body.includes("subscribed at Tier")).length;
verifier(sat.sortie.includes(`${nbAnnonces} de bots, de commandes ou d'annonces, ignorés`), "les annonces d'abonnement sont ignorées", sat.sortie.split("\n")[1]);

// Une réaction qui monte sur 3 tranches (0:20:00, 0:20:10, puis le pic à 0:20:20),
// puis une longue danse dans le chat jusqu'à 0:21:30.
const montee = [];
let q = 0;
for (let t = 0; t < 1800; t += 1) for (let k = 0; k < 1; k++) montee.push({ content_offset_seconds: t, commenter: { name: `b${q++ % 300}` }, message: { body: banal[q % banal.length] } });
const vague = (debut, nombre) => { for (let k = 0; k < nombre; k++) montee.push({ content_offset_seconds: debut + (k % 10), commenter: { name: `v${debut}_${k}` }, message: { body: "MDRRR 😂" } }); };
vague(1200, 40); vague(1210, 45); vague(1220, 60);
for (let t = 1230; t < 1290; t += 10) vague(t, 30);
montee.sort((a, b) => a.content_offset_seconds - b.content_offset_seconds);
writeFileSync(join(dossier, "montee.json"), JSON.stringify(racine(0, montee)));
const mt = lancer("montee.json", "--liste");
verifier(/t=0h19m40s/.test(mt.sortie), "le clip commence 20 s avant le DÉBUT de la réaction, pas avant son pic", mt.sortie);
verifier(momentsListes(mt.sortie).length === 1, "une longue réaction ne donne qu'un seul clip", `moments : ${momentsListes(mt.sortie).join(", ")}`);

// Fichiers abîmés ou mauvais fichiers
const complet = JSON.stringify(racine(0, commentaires));
writeFileSync(join(dossier, "tronque.json"), complet.slice(0, Math.floor(complet.length * 0.6)));
const tr = lancer("tronque.json", "--liste");
verifier(tr.code === 1 && /incomplet/.test(tr.sortie), "un chat tronqué est signalé (pas analysé à moitié)", tr.sortie.trim());
writeFileSync(join(dossier, "live-par-erreur.mp4"), Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
const vid = lancer("live-par-erreur.mp4");
verifier(vid.code === 1 && /c'est une vidéo, pas un chat/.test(vid.sortie), "une vidéo donnée à la place du chat est refusée tout de suite", vid.sortie.trim());
for (const [lien, attendu, nom] of [
  ["https://www.twitch.tv/kaicenat", "lien d'une chaîne", "lien de chaîne"],
  ["https://clips.twitch.tv/DrolePetitClip", "lien d'un clip", "lien de clip"],
  ["https://www.youtube.com/watch?v=abc", "seuls les lives Twitch", "lien YouTube"],
]) {
  const r = lancer(lien, "--liste");
  verifier(r.code === 1 && r.sortie.includes(attendu), `message clair pour un ${nom}`, r.sortie.trim());
}

// Erreurs de TwitchDownloader et guillemets
const morceauxOutil = (debut, fin) => outilSource.slice(outilSource.indexOf(debut), outilSource.indexOf(fin));
const { erreurTwitch, entreGuillemets } = await import("data:text/javascript," + encodeURIComponent(
  morceauxOutil("const pluriel", "function hms") + morceauxOutil("function erreurTwitch", "function lancerTwitch") +
  "\nexport { erreurTwitch, entreGuillemets };"));
const expiree = erreurTwitch("Unhandled exception. System.AggregateException: One or more errors occurred. (Invalid VOD, deleted/expired VOD possibly?)\n ---> System.NullReferenceException: Invalid VOD, deleted/expired VOD possibly?\n   at X.Y()\n   --- End of inner exception stack trace ---\n   at Z()", 134);
verifier(expiree.grave && /n'existe plus/.test(expiree.message), "erreur TwitchDownloader traduite : VOD expirée", expiree.message);
const aide = erreurTwitch("ERROR(S):\n  Option 'b' is defined with a bad format.\n  --oauth    OAuth access token to download subscriber only VODs.", 1);
verifier(/n'a pas compris/.test(aide.message), "une erreur d'option n'est pas prise pour une VOD réservée aux abonnés", aide.message);
const abonnes = erreurTwitch("Unhandled exception. System.NullReferenceException: Insufficient access to VOD, OAuth may be required.", 134);
verifier(abonnes.grave && /réservée aux abonnés/.test(abonnes.message), "erreur TwitchDownloader traduite : VOD réservée aux abonnés", abonnes.message);
verifier(entreGuillemets("https://www.twitch.tv/videos/1?t=1h&x=2").startsWith('"'), "un lien avec ? ou & est mis entre guillemets dans les conseils affichés");

const gz = lancer("chat.json.gz", "--liste");
verifier(JSON.stringify(momentsListes(gz.sortie)) === JSON.stringify(trouves), "un chat compressé (.json.gz) donne le même résultat");

for (const [args, attendu, nom] of [
  [["absent.json"], "fichier introuvable", "fichier absent"],
  [["chat.json", "--nombre", "abc"], "attend un nombre", "--nombre invalide"],
  [["chat.json", "--avance", "40"], "doit être plus petit que --duree", "--avance plus grand que --duree"],
  [["chat.json", "--vod"], "attend une valeur", "--vod sans fichier"],
  [["chat.json", "--truc"], "option inconnue", "option inconnue"],
  [["chat.json", "--position", "150"], "--position va de 0", "--position hors limites"],
]) {
  const r = lancer(...args);
  verifier(r.code === 1 && r.sortie.includes(attendu), `erreur claire : ${nom}`, r.sortie.trim());
}
writeFileSync(join(dossier, "pas-un-chat.json"), JSON.stringify({ bonjour: 1 }));
const pasChat = lancer("pas-un-chat.json");
verifier(pasChat.code === 1 && /pas de liste « comments »/.test(pasChat.sortie), "erreur claire : JSON qui n'est pas un chat");

// ---------- Découpe (si ffmpeg est installé) ----------
const ffmpeg = spawnSync("ffmpeg", ["-version"]);
if (ffmpeg.error || ffmpeg.status !== 0) {
  console.log("\n(ffmpeg absent : tests de découpe sautés)");
} else {
  // Vidéo de test : l'image affiche le temps écoulé en secondes, et dure 30 min.
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=5:duration=1800",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1800", "-c:v", "libx264", "-preset", "ultrafast",
    "-crf", "35", "-c:a", "aac", "-shortest", join(dossier, "live.mp4")]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "600", "-i", join(dossier, "live.mp4"), "-c:v", "libx264",
    "-preset", "ultrafast", "-crf", "35", "-c:a", "aac", join(dossier, "live-coupe.mp4")]);
  const decoupe = lancer("chat.json", "--vod", "live.mp4", "--nombre", "2", "--dossier", "sortie");
  const clips = existsSync(join(dossier, "sortie")) ? readdirSync(join(dossier, "sortie")).filter((f) => f.endsWith(".mp4")) : [];
  verifier(decoupe.code === 0 && clips.length === 2, "--vod coupe les clips", decoupe.sortie);
  const info = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration",
    "-of", "csv=p=0", join(dossier, "sortie", clips[0] ?? "x")], { encoding: "utf8" }).stdout ?? "";
  verifier(/1080,1920/.test(info) && /30\.0/.test(info), "les clips font 1080 × 1920 et 30 s", info.trim());
  verifier(existsSync(join(dossier, "sortie", "moments.csv")), "la liste moments.csv est écrite");

  // Le chat et la vidéo coupés à 10 min : le clip du pic de 27:10 doit commencer à 16:50 dans le fichier.
  const coupe = lancer("chat-coupe.json", "--vod", "live-coupe.mp4", "--nombre", "1", "--dossier", "sortie-coupe", "--flou");
  verifier(coupe.code === 0 && /live 0:26:50 → 0:27:20/.test(coupe.sortie), "chat et vidéo coupés pareil : le temps est recalé", coupe.sortie);
  const plein = lancer("chat.json", "--vod", "live.mp4", "--nombre", "1", "--position", "0", "--dossier", "sortie-gauche");
  verifier(plein.code === 0 && /cadré à 0 %/.test(plein.sortie), "--position recadre à gauche", plein.sortie);

  // ---------- Face cam ----------
  // Faux live gris avec un carré vert au centre (le « jeu ») et un carré rouge dans un coin (la « face cam »).
  const fauxLive = (nom, cam) => spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x808080:size=640x360:rate=5:duration=1800",
    "-vf", `drawbox=x=${cam}:color=red:t=fill,drawbox=x=280:y=130:w=80:h=80:color=0x00c000:t=fill`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", join(dossier, nom)]);
  fauxLive("live-cam-bd.mp4", "480:y=270:w=160:h=90"); // en bas à droite, 25 % de large
  fauxLive("live-cam-hg.mp4", "0:y=0:w=192:h=108");    // en haut à gauche, 30 % de large
  // Couleur moyenne d'une zone d'un clip (l × h pixels à partir de x, y), 5 s après son début.
  const zone = (fichier, l, h, x, y) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-ss", "5", "-i", fichier, "-vf", `crop=${l}:${h}:${x}:${y},scale=1:1:flags=area`,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [...(r.stdout ?? []).subarray(0, 3)];
  };
  const rouge = ([r, g, b]) => r > 150 && g < 90 && b < 90;
  const clipDe = (sortie) => join(dossier, sortie, readdirSync(join(dossier, sortie)).find((f) => f.endsWith(".mp4")) ?? "x");

  const bd = lancer("chat.json", "--vod", "live-cam-bd.mp4", "--nombre", "1", "--facecam", "bas-droite", "--facecam-taille", "25", "--dossier", "sortie-cam-bd");
  const fichierBd = clipDe("sortie-cam-bd");
  const tailleBd = (spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", fichierBd], { encoding: "utf8" }).stdout ?? "").trim();
  verifier(bd.code === 0 && tailleBd === "1080,1920", "--facecam : le clip fait 1080 × 1920", bd.sortie + tailleBd);
  verifier(rouge(zone(fichierBd, 600, 400, 240, 1400)), "--facecam : la face cam est en bas de l'écran", String(zone(fichierBd, 600, 400, 240, 1400)));
  verifier(!rouge(zone(fichierBd, 800, 900, 140, 200)) && zone(fichierBd, 100, 100, 490, 600)[1] > 120, "--facecam : le jeu est en haut, sans la face cam", String(zone(fichierBd, 800, 900, 140, 200)));
  verifier(existsSync(join(dossier, "sortie-cam-bd", "apercu-facecam.png")), "--facecam : l'image du cadrage est écrite");

  const rect = lancer("chat.json", "--vod", "live-cam-bd.mp4", "--nombre", "1", "--facecam", "75,75,25,25", "--dossier", "sortie-cam-rect");
  verifier(rect.code === 0 && rouge(zone(clipDe("sortie-cam-rect"), 600, 400, 240, 1400)), "--facecam avec des coordonnées x,y,largeur,hauteur", rect.sortie);

  const apercu = lancer("chat.json", "--vod", "live-cam-bd.mp4", "--nombre", "1", "--facecam", "bas-droite", "--facecam-taille", "25", "--apercu", "--dossier", "sortie-apercu");
  const clipsApercu = existsSync(join(dossier, "sortie-apercu")) ? readdirSync(join(dossier, "sortie-apercu")).filter((f) => f.endsWith(".mp4")) : [];
  verifier(apercu.code === 0 && existsSync(join(dossier, "sortie-apercu", "apercu-facecam.png")) && clipsApercu.length === 0 && /cadre rouge/.test(apercu.sortie),
    "--apercu : fabrique seulement l'image du cadrage, sans couper de clip", apercu.sortie);

  // Face cam en haut à gauche : le recadrage du jeu se décale pour ne pas la montrer deux fois, sauf si on impose --position.
  const hg = lancer("chat.json", "--vod", "live-cam-hg.mp4", "--nombre", "1", "--facecam", "haut-gauche", "--facecam-taille", "30", "--dossier", "sortie-cam-hg");
  verifier(hg.code === 0 && !rouge(zone(clipDe("sortie-cam-hg"), 40, 200, 0, 0)) && rouge(zone(clipDe("sortie-cam-hg"), 600, 400, 240, 1400)),
    "--facecam : le jeu se décale pour ne pas montrer la face cam en double", hg.sortie);
  const hgPos = lancer("chat.json", "--vod", "live-cam-hg.mp4", "--nombre", "1", "--facecam", "haut-gauche", "--facecam-taille", "30", "--position", "50", "--dossier", "sortie-cam-hg-pos");
  verifier(hgPos.code === 0 && rouge(zone(clipDe("sortie-cam-hg-pos"), 40, 200, 0, 0)), "--facecam avec --position : on obéit, même si la face cam déborde", hgPos.sortie);
  const flou = lancer("chat.json", "--vod", "live-cam-bd.mp4", "--nombre", "1", "--facecam", "bas-droite", "--facecam-taille", "25", "--flou", "--dossier", "sortie-cam-flou");
  verifier(flou.code === 0 && rouge(zone(clipDe("sortie-cam-flou"), 600, 400, 240, 1400)), "--facecam avec --flou", flou.sortie);
}

for (const [args, attendu, nom] of [
  [["chat.json", "--facecam", "milieu"], "--facecam attend un coin", "--facecam avec un coin inconnu"],
  [["chat.json", "--facecam", "90,0,30,30"], "sort de l'image", "--facecam hors de l'image"],
  [["chat.json", "--facecam", "1,2,3"], "--facecam attend un coin", "--facecam avec 3 nombres"],
  [["chat.json", "--apercu"], "va avec --facecam", "--apercu sans --facecam"],
  [["chat.json", "--facecam", "haut-gauche", "--apercu", "--liste"], "ne vont pas ensemble", "--apercu avec --liste"],
  [["chat.json", "--facecam", "haut-gauche", "--facecam-taille", "80"], "va de 5 à 60", "--facecam-taille trop grand"],
]) {
  const r = lancer(...args);
  verifier(r.code === 1 && r.sortie.includes(attendu), `erreur claire : ${nom}`, r.sortie.trim());
}

rmSync(dossier, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} test(s) en échec.` : "\nTous les tests passent.");
process.exit(echecs ? 1 : 0);
