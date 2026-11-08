# YouTube Summarizer

Paste a YouTube URL, get a collapsible outline of the video (sections → sub-points),
with real chapter timestamps when the creator provided them, and a running tally of
how much time you've saved by reading instead of watching. Everything is stored
locally in SQLite.

## How it works

1. `yt-dlp` grabs the video's metadata (title, channel, duration, thumbnail) and its
   **chapters** if the creator added a timeline.
2. `yt-dlp` also downloads just the audio track (mp3).
3. `faster-whisper` (Python, runs fully locally, no API calls) transcribes the audio
   with timestamps.
4. If chapters exist, the transcript is bucketed into them. If not, the transcript
   (with timestamps) is sent to Claude, which is asked to infer sensible sections
   itself.
5. Claude turns the transcript into a JSON tree: sections → timestamp → subsections
   (bullet points).
6. Everything (video metadata + the summary tree + word count + time saved) is saved
   to `data/library.sqlite`.
7. "Time saved" = video duration minus the estimated time to *read* the summary
   (~220 words/minute).

## One-time setup

You'll need on your machine:
- **Node.js 18+**
- **Python 3.9+**
- **ffmpeg** (required by both yt-dlp and whisper) — `brew install ffmpeg` / `apt install ffmpeg`
- **yt-dlp** — `pip install yt-dlp` or `brew install yt-dlp`
- **faster-whisper** — `pip install faster-whisper`

Then:

```bash
npm install
cp .env.example .env
# edit .env and paste your Anthropic API key (console.anthropic.com)
npm start
```

Open http://localhost:3000.

## Notes / things worth tuning together next

- **Whisper model size**: `services/transcribe.py` defaults to `small` (good
  speed/accuracy balance on CPU). Bump to `medium` for better accuracy on
  dense/technical videos, or `base` for near-instant but rougher transcripts.
- **Whisper on GPU**: if you have CUDA available, change `device="cpu"` to
  `device="cuda"` in `transcribe.py` for a big speed boost.
- **Long videos**: transcription time scales with video length; for anything over
  ~30 min on CPU, expect it to take a while. Worth adding a job queue + progress
  bar (currently it's a single blocking request) if you plan to batch a backlog.
- **Chapters vs. no chapters**: many creators don't add YouTube chapters, in which
  case Claude infers the sections from timestamps in the raw transcript — quality
  here is the main thing worth iterating on (prompt tuning in `summarizer.js`).
- **Re-summarizing**: `POST /api/summarize` with `{ "url": ..., "forceRefresh": true }`
  bypasses the cache and redoes the whole pipeline.
# ytb-summarizer
