#!/usr/bin/env node
// Writes a fake TwitchDownloader chat export, so the tool can be tried
// without downloading anything:
//
//   node examples/make-demo-chat.mjs > demo-chat.json
//   node chat-clips.mjs demo-chat.json --dry-run
//
// 20 minutes of calm chat with three planted moments, at 04:30, 11:00 and 16:20.

const DURATION = 20 * 60;
const MOMENTS = [270, 660, 980];
const calm = ["gg", "lol", "nice", "o7", "chill stream", "hi chat", "what server is this", "W", "first time here", "lets go"];
const hype = ["LMAO", "CLIP IT", "NO WAY", "LMAOOO", "KEKW", "CLIP THAT", "W", "OMEGALUL", "???", "HOLY"];

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];

const comments = [];
for (let t = 0; t < DURATION; t += 0.5) {
  // a slow background rhythm, ~1 message every 2-3 seconds
  if (rand() < 0.2) comments.push({ t, msg: pick(calm) });
  for (const m of MOMENTS) {
    // chat reacts a few seconds after the moment and calms down over ~25 s
    const dt = t - (m + 5);
    if (dt >= 0 && dt < 25 && rand() < 3 * Math.exp(-dt / 8)) {
      comments.push({ t, msg: pick(hype) });
      if (rand() < 0.6) comments.push({ t: t + 0.2, msg: pick(hype) });
    }
  }
}

const out = {
  FileInfo: { Version: { Major: 1, Minor: 4, Patch: 0 }, CreatedAt: new Date().toISOString() },
  streamer: { name: "demo_streamer", id: 1 },
  video: { title: "Demo stream, hour 1", id: "", start: 0, end: DURATION, length: DURATION },
  comments: comments.map((c, i) => ({
    _id: `demo-${i}`,
    content_offset_seconds: Math.round(c.t * 10) / 10,
    commenter: { display_name: `viewer${Math.floor(rand() * 500)}` },
    message: { body: c.msg },
  })),
};
process.stdout.write(JSON.stringify(out));
