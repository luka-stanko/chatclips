# chat-clips

**The best clip finder isn't AI. It's chat.**

When something crazy happens on stream, chat explodes: hundreds of "LMAO" in ten
seconds. `chat-clips` reads a stream's whole chat, counts the messages every 10
seconds, finds where chat spikes above its normal level, rewinds 20 seconds
(chat reacts *after* the moment), and cuts each moment as a vertical 9:16 clip.

One file. Zero npm dependencies. Free.

```
$ node chat-clips.mjs chat.json --vod 2345678901

GTA RP, hour 4 of 6
48211 messages over 06:02:13

chat activity (busiest 10s bucket: 340 messages), numbers mark the clips
▁▁▂▁▁▁▂▁▁▁▁▂▁▅█▁▁▁▁▂▁▁▁▁▁▁▁▁▂▁▁▁▁▆▃▁▂▁▁▁▁▁▁▁▁▁▁▂▁▆▃▁▁▁▁▂▁▁▁▂
              1                  2               3

#1  spike 01:32:40  score 11.9  340 msgs  ->  clip 01:32:20 to 01:33:05
     chat: "LMAO" x61, "CLIP IT" x40, "NO WAY" x22
     saved clips/clip-01-01-32-40.mp4
...
```

## How it works

1. **Get the chat.** [TwitchDownloader](https://github.com/lay295/TwitchDownloader)
   (free, open source, MIT) exports the full chat of any Twitch VOD as JSON.
2. **Count.** Messages are counted in 10 second buckets. Hype messages
   (`LMAO`, `KEKW`, `CLIP IT`, `W`, `???` ...) count a bit extra.
3. **Find the spikes.** Each bucket is compared with the five minutes of chat
   around it (median and MAD, so a busy hour and a calm hour are each judged
   against themselves). Buckets far above normal are moments.
4. **Rewind.** Chat reacts a few seconds after the moment, so each clip starts
   20 seconds before the spike and runs 45 seconds.
5. **Cut vertical.** ffmpeg cuts the window and lays it out in 9:16, either the
   full 16:9 frame over a blurred copy of itself (default) or a centre crop.
   When the VOD is online, only the needed minutes are downloaded with yt-dlp,
   never the whole six-hour stream.

## Install

You need:

- [Node.js](https://nodejs.org) 18 or newer
- [ffmpeg](https://ffmpeg.org/download.html) on your PATH
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH, only if the VOD is not
  a local file

```bash
git clone https://github.com/<you>/chat-clips.git
cd chat-clips
node chat-clips.mjs --help
```

Try it without downloading anything:

```bash
node examples/make-demo-chat.mjs > demo-chat.json
node chat-clips.mjs demo-chat.json --dry-run
```

## Usage

**1. Download the chat** of a VOD with TwitchDownloader. In the app: *Chat
Download*, paste the VOD link, format **JSON**. Or with the CLI:

```bash
TwitchDownloaderCLI chatdownload --id 2345678901 -o chat.json
```

**2. Run the tool:**

```bash
# the VOD id is read from chat.json, only the clip sections are downloaded
node chat-clips.mjs chat.json

# or from a VOD you already downloaded
node chat-clips.mjs chat.json --vod stream.mp4

# just look at the spikes first, cut nothing
node chat-clips.mjs chat.json --dry-run
```

**3. Caption them.** The clips land in `clips/`, best first. Drop them into a
captioning tool such as [OpenShorts](https://github.com/mutonby/openshorts)
(open source) or your editor of choice.

### Options

| Option | Default | What it does |
|---|---|---|
| `--vod <x>` | id from chat.json | Local file, any URL yt-dlp reads, or a Twitch VOD id |
| `--bucket <s>` | 10 | Seconds per counting bucket |
| `--lead <s>` | 20 | Seconds to start before the spike |
| `--length <s>` | 45 | Clip length |
| `--top <n>` | 10 | Maximum number of clips |
| `--gap <s>` | 90 | Minimum seconds between two clips |
| `--min-score <z>` | 3 | How far above normal a spike must be. Lower it for small streams |
| `--window <s>` | 300 | Seconds of surrounding chat that define "normal" |
| `--keywords <list>` | built in | Comma list of hype words that count extra |
| `--keyword-weight <n>` | 0.5 | Extra weight of a hype message |
| `--layout <mode>` | blur | `blur`, `crop` or `none` |
| `--height <px>` | 1920 | Output height (width is 9/16 of it) |
| `--out <dir>` | clips | Output folder |
| `--dry-run` | | Detect and report only |

### Output

- `clip-01-<hh-mm-ss>.mp4` ... the clips, best spike first, named after the
  moment in the stream
- `clips.json`: every clip with its start, end, score, message count, the most
  repeated messages and a Twitch link at the right second
- `chart.txt`: the chat activity over the whole stream

### Other chat sources

Any chat works if you convert it to a plain array:

```json
[{ "t": 12.5, "msg": "LMAO" }, { "t": 13.1, "msg": "clip it" }]
```

`t` is the number of seconds since the start of the video.

## Tuning tips

- **Small stream, few clips found?** `--min-score 2 --bucket 15`.
- **Too many clips from the same moment?** Raise `--gap`.
- **The clip starts too early or too late?** Change `--lead`. 20 seconds fits
  most Twitch chats; a stream with a long delay may need 30.
- **Facecam on one side?** `--layout crop` keeps the centre; `blur` keeps the
  whole frame.

## Please clip responsibly

Streams belong to the people who make them. Only clip creators who allow it,
credit them, and follow Twitch's terms and each creator's own clipping rules.
This tool finds moments; what you publish is on you.

## License

MIT. See [LICENSE](LICENSE).
