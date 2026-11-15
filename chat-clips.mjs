#!/usr/bin/env node
// chat-clips: find the best moments of a long stream by reading its chat,
// then cut them as vertical clips.
//
// The idea: when something crazy happens on stream, chat explodes. Count the
// messages in small time buckets, find where the count spikes above the
// stream's normal level, rewind a little (chat reacts AFTER the moment), and
// cut that window out of the VOD in 9:16.
//
// One file, zero npm dependencies. Needs Node 18+, and ffmpeg (plus yt-dlp
// when the VOD is not a local file) on the PATH.
//
//   node chat-clips.mjs chat.json --vod <id | url | file.mp4> [options]
//
// Run with --help for every option. MIT licensed.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const DEFAULTS = {
  out: "clips",
  bucket: 10,      // seconds per counting bucket
  lead: 20,        // seconds to rewind before the spike (chat lags the moment)
  length: 45,      // clip length in seconds
  top: 10,         // how many clips at most
  gap: 90,         // minimum seconds between two clips
  minScore: 3,     // how far above normal a bucket must be (robust z-score)
  window: 300,     // seconds of surrounding chat that define "normal"
  layout: "blur",  // blur | crop | none
  height: 1920,    // output height for vertical layouts (width = height * 9/16)
  keywords: "lmao,lol,lul,kekw,omegalul,lmfao,pog,poggers,w,clip,clip it,clip that,no way,wtf,omg,holy,???,!!!",
  keywordWeight: 0.5,
};

const HELP = `chat-clips: turn a stream's chat into vertical clips of its best moments.

Usage
  node chat-clips.mjs <chat.json> [--vod <id|url|file>] [options]

Input
  <chat.json>          Chat exported by TwitchDownloader (GUI or CLI, JSON format).
                       A plain array of {"t": seconds, "msg": "text"} also works.
  --vod <x>            The video to cut from: a local file, a URL yt-dlp can read,
                       or a Twitch VOD id. If omitted, the VOD id stored in
                       chat.json is used. With --dry-run nothing is cut.

Detection
  --bucket <s>         Seconds per counting bucket            (default ${DEFAULTS.bucket})
  --window <s>         Seconds of chat that define "normal"   (default ${DEFAULTS.window})
  --min-score <z>      How far above normal a spike must be   (default ${DEFAULTS.minScore})
  --keywords <list>    Comma list of hype words that count extra
  --keyword-weight <n> Extra weight per hype message           (default ${DEFAULTS.keywordWeight})

Clips
  --top <n>            Maximum number of clips                 (default ${DEFAULTS.top})
  --lead <s>           Seconds to start before the spike       (default ${DEFAULTS.lead})
  --length <s>         Clip length in seconds                  (default ${DEFAULTS.length})
  --gap <s>            Minimum seconds between two clips       (default ${DEFAULTS.gap})
  --layout <mode>      blur (16:9 inside a blurred 9:16), crop (centre crop),
                       or none (keep the original frame)       (default ${DEFAULTS.layout})
  --height <px>        Output height for vertical layouts      (default ${DEFAULTS.height})
  --out <dir>          Output folder                           (default ${DEFAULTS.out})
  --dry-run            Only detect and report, cut nothing

Output, in --out
  clip-01-<hh-mm-ss>.mp4 ...   the clips, best first
  clips.json                   every clip with its times, score and top messages
  chart.txt                    the chat activity over the whole stream
`;

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = { ...DEFAULTS, dryRun: false, chat: null, vod: null };
  const num = (k, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) die(`--${k} expects a positive number, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`${a} expects a value`);
      return argv[++i];
    };
    switch (a) {
      case "-h": case "--help": process.stdout.write(HELP); process.exit(0);
      case "--vod": opts.vod = next(); break;
      case "--out": opts.out = next(); break;
      case "--bucket": opts.bucket = num("bucket", next()); break;
      case "--window": opts.window = num("window", next()); break;
      case "--min-score": opts.minScore = num("min-score", next()); break;
      case "--keywords": opts.keywords = next(); break;
      case "--keyword-weight": opts.keywordWeight = num("keyword-weight", next()); break;
      case "--top": opts.top = num("top", next()); break;
      case "--lead": opts.lead = num("lead", next()); break;
      case "--length": opts.length = num("length", next()); break;
      case "--gap": opts.gap = num("gap", next()); break;
      case "--layout": opts.layout = next(); break;
      case "--height": opts.height = num("height", next()); break;
      case "--dry-run": opts.dryRun = true; break;
      default:
        if (a.startsWith("-")) die(`Unknown option ${a}. Run with --help.`);
        if (opts.chat) die(`Only one chat file, got "${opts.chat}" and "${a}"`);
        opts.chat = a;
    }
  }
  if (!opts.chat) { process.stdout.write(HELP); process.exit(1); }
  if (!["blur", "crop", "none"].includes(opts.layout)) die(`--layout must be blur, crop or none`);
  if (opts.bucket <= 0 || opts.length <= 0) die("--bucket and --length must be above zero");
  return opts;
}

function die(msg) {
  process.stderr.write(`chat-clips: ${msg}\n`);
  process.exit(1);
}

// ---------- reading the chat ----------

// Returns { messages: [{t, msg, user}], duration, vodId, title }
export function readChat(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { die(`cannot read ${path} as JSON (${e.message})`); }

  let messages = [];
  let duration = 0, vodId = null, title = null;

  if (Array.isArray(raw)) {
    // Minimal format: [{t, msg, user?}]
    messages = raw.map((m) => ({ t: Number(m.t), msg: String(m.msg ?? ""), user: m.user ?? "" }));
  } else if (raw && Array.isArray(raw.comments)) {
    // TwitchDownloader format
    messages = raw.comments.map((c) => ({
      t: Number(c.content_offset_seconds),
      msg: String(c.message?.body ?? ""),
      user: c.commenter?.display_name ?? c.commenter?.name ?? "",
    }));
    const v = raw.video ?? {};
    vodId = v.id ? String(v.id) : null;
    title = v.title ?? null;
    duration = Number(v.length ?? v.end ?? 0) || 0;
  } else {
    die(`${path} is not a TwitchDownloader chat export (no "comments" array)`);
  }

  messages = messages.filter((m) => Number.isFinite(m.t) && m.t >= 0).sort((a, b) => a.t - b.t);
  if (messages.length === 0) die(`${path} contains no chat messages`);
  duration = Math.max(duration, messages[messages.length - 1].t);
  return { messages, duration, vodId, title };
}

// ---------- detection ----------

function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function buildKeywordMatcher(list) {
  const words = list.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const alnum = words.filter((w) => /^[a-z0-9 ]+$/.test(w));
  const symbols = words.filter((w) => !/^[a-z0-9 ]+$/.test(w));
  const re = alnum.length
    ? new RegExp(`(^|[^a-z0-9])(${alnum.map((w) => w.replace(/ /g, "\\s+")).join("|")})([^a-z0-9]|$)`, "i")
    : null;
  return (msg) => {
    const m = msg.toLowerCase();
    return (re && re.test(m)) || symbols.some((s) => m.includes(s));
  };
}

// Score every bucket against the chat activity around it, then keep the
// strongest peaks that are at least `gap` seconds apart.
export function findMoments(chat, opts) {
  const { messages, duration } = chat;
  const n = Math.max(1, Math.ceil((duration + 1) / opts.bucket));
  const counts = new Array(n).fill(0);
  const weighted = new Array(n).fill(0);
  const isHype = buildKeywordMatcher(opts.keywords);

  for (const m of messages) {
    const b = Math.min(n - 1, Math.floor(m.t / opts.bucket));
    counts[b] += 1;
    weighted[b] += 1 + (isHype(m.msg) ? opts.keywordWeight : 0);
  }

  // "Normal" is the median of the surrounding window, so a calm hour and a
  // busy hour are each judged against themselves. MAD gives a spread that a
  // few huge spikes cannot inflate.
  const half = Math.max(1, Math.round(opts.window / opts.bucket / 2));
  const scores = weighted.map((v, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
    const around = weighted.slice(lo, hi);
    const med = median(around);
    const mad = median(around.map((x) => Math.abs(x - med))) * 1.4826;
    return (v - med) / (mad + 1);
  });

  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const picked = [];
  for (const i of order) {
    if (picked.length >= opts.top) break;
    if (scores[i] < opts.minScore) break;
    const t = i * opts.bucket;
    if (picked.some((p) => Math.abs(p.peak - t) < opts.gap)) continue;
    const start = Math.max(0, t - opts.lead);
    const end = Math.min(duration, start + opts.length);
    const inside = messages.filter((m) => m.t >= t && m.t < t + opts.bucket);
    picked.push({
      peak: t,
      start,
      end,
      score: Math.round(scores[i] * 10) / 10,
      messages: counts[i],
      sample: topMessages(inside, 5),
    });
  }
  return { moments: picked, counts, scores };
}

function topMessages(msgs, k) {
  const freq = new Map();
  for (const m of msgs) {
    const key = m.msg.trim().replace(/\s+/g, " ").slice(0, 40);
    if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([text, n]) => ({ text, n }));
}

// ---------- reporting ----------

export function hms(sec, sep = ":") {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((x) => String(x).padStart(2, "0")).join(sep);
}

function twitchTime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}

function chart(counts, bucket, moments, width = 100) {
  const per = Math.max(1, Math.ceil(counts.length / width));
  const cols = [];
  for (let i = 0; i < counts.length; i += per) cols.push(Math.max(...counts.slice(i, i + per)));
  const max = Math.max(1, ...cols);
  const bars = " ▁▂▃▄▅▆▇█";
  const line = cols.map((c) => (c === 0 ? " " : bars[Math.max(1, Math.round((c / max) * (bars.length - 1)))])).join("");
  const marks = new Array(cols.length).fill(" ");
  moments.forEach((m, idx) => {
    const c = Math.min(cols.length - 1, Math.floor(m.peak / bucket / per));
    marks[c] = idx < 9 ? String(idx + 1) : "+";
  });
  const total = counts.length * bucket;
  return [
    `chat activity (busiest ${bucket}s bucket: ${max} messages), numbers mark the clips`,
    line,
    marks.join(""),
    `00:00:00${" ".repeat(Math.max(1, cols.length - 16))}${hms(total)}`,
  ].join("\n");
}

// ---------- cutting ----------

function have(cmd) {
  const r = spawnSync(cmd, ["-version"], { stdio: "ignore" });
  return !r.error;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.error) return { ok: false, err: r.error.message };
  if (r.status !== 0) return { ok: false, err: (r.stderr || "").trim().split("\n").slice(-4).join("\n") };
  return { ok: true };
}

function videoFilter(layout, height) {
  const w = Math.round((height * 9) / 16 / 2) * 2;
  if (layout === "crop") return `crop=ih*9/16:ih,scale=${w}:${height},setsar=1`;
  if (layout === "blur")
    return [
      `split=2[bg][fg]`,
      `[bg]scale=${w}:${height}:force_original_aspect_ratio=increase,crop=${w}:${height},boxblur=20:2[bgb]`,
      `[fg]scale=${w}:-2[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1`,
    ].join(";");
  return null;
}

function resolveSource(vod, chat) {
  const v = vod ?? chat.vodId;
  if (!v) return null;
  if (existsSync(v)) return { kind: "file", path: resolve(v) };
  if (/^\d+$/.test(v)) return { kind: "url", url: `https://www.twitch.tv/videos/${v}` };
  if (/^https?:\/\//.test(v)) return { kind: "url", url: v };
  die(`--vod "${v}" is neither a file, a URL nor a Twitch VOD id`);
}

function cutClip(src, m, outFile, opts, tmpDir) {
  let input = src.path, ss = m.start;
  if (src.kind === "url") {
    // Download only the needed section, not the whole six-hour VOD.
    const part = join(tmpDir, `part-${m.peak}.mp4`);
    const r = run("yt-dlp", [
      "-q", "--no-warnings", "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--download-sections", `*${m.start}-${m.end}`, "--force-keyframes-at-cuts",
      "--merge-output-format", "mp4", "-o", part, src.url,
    ]);
    if (!r.ok) return r;
    input = part; ss = 0;
  }
  const vf = videoFilter(opts.layout, opts.height);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(ss), "-i", input, "-t", String(m.end - m.start)];
  if (vf) args.push(opts.layout === "blur" ? "-filter_complex" : "-vf", vf);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile);
  return run("ffmpeg", args);
}

// ---------- main ----------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chat = readChat(opts.chat);
  const { moments, counts } = findMoments(chat, opts);

  mkdirSync(opts.out, { recursive: true });
  const graph = chart(counts, opts.bucket, moments);
  writeFileSync(join(opts.out, "chart.txt"), graph + "\n");

  console.log(`\n${chat.title ? chat.title + "\n" : ""}${chat.messages.length} messages over ${hms(chat.duration)}\n`);
  console.log(graph + "\n");

  if (moments.length === 0) {
    console.log(`No spike above --min-score ${opts.minScore}. Try a lower value, e.g. --min-score 2.`);
    writeFileSync(join(opts.out, "clips.json"), JSON.stringify({ clips: [] }, null, 2));
    return;
  }

  const src = opts.dryRun ? null : resolveSource(opts.vod, chat);
  if (!opts.dryRun) {
    if (!src) die("no --vod given and chat.json carries no VOD id. Pass --vod, or use --dry-run.");
    if (!have("ffmpeg")) die("ffmpeg is not on the PATH. Install it, or use --dry-run.");
    if (src.kind === "url" && !have("yt-dlp")) die("yt-dlp is not on the PATH (needed to fetch the VOD). Install it, or pass a local file.");
  }

  const tmpDir = join(opts.out, ".parts");
  if (src?.kind === "url") mkdirSync(tmpDir, { recursive: true });

  const report = [];
  moments.forEach((m, idx) => {
    const name = `clip-${String(idx + 1).padStart(2, "0")}-${hms(m.peak, "-")}.mp4`;
    const line = `#${idx + 1}  spike ${hms(m.peak)}  score ${m.score}  ${m.messages} msgs  ->  clip ${hms(m.start)} to ${hms(m.end)}`;
    const said = m.sample.map((s) => `"${s.text}" x${s.n}`).join(", ");
    console.log(line + (said ? `\n     chat: ${said}` : ""));
    const entry = { file: opts.dryRun ? null : name, ...m, link: chat.vodId ? `https://www.twitch.tv/videos/${chat.vodId}?t=${twitchTime(m.start)}` : null };
    if (!opts.dryRun) {
      const r = cutClip(src, m, join(opts.out, name), opts, tmpDir);
      if (r.ok) console.log(`     saved ${join(opts.out, name)}`);
      else { console.log(`     FAILED: ${r.err}`); entry.file = null; entry.error = r.err; }
    }
    report.push(entry);
  });

  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  writeFileSync(join(opts.out, "clips.json"), JSON.stringify({ source: opts.chat, options: opts, clips: report }, null, 2));
  const ok = report.filter((r) => r.file).length;
  console.log(`\n${opts.dryRun ? "Dry run, nothing cut." : `${ok}/${report.length} clips in ${opts.out}/`}  Details: ${join(opts.out, "clips.json")}`);
  if (!opts.dryRun && ok < report.length) process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) main();
