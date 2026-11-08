import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractYoutubeId, fetchMetadata, downloadAudio } from '../services/ytdlp.js';
import { transcribeAudio } from '../services/transcriber.js';
import { summarizeTranscript } from '../services/summarizer.js';
import {
  upsertVideo, setVideoStatus, getVideoById,
  insertSummary, getLatestSummaryForVideo,
  listVideosWithSummaries, getStats,
} from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'data', 'audio');
const WORDS_PER_MINUTE = 220;

const router = express.Router();

router.post('/summarize', async (req, res) => {
  const { url, forceRefresh } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let video;
  try {
    const youtubeId = extractYoutubeId(url);

    // If we already summarized this one and no refresh requested, return cached result.
    video = upsertVideo({
      youtube_id: youtubeId, url, title: null, channel: null,
      duration_seconds: null, thumbnail_url: null, status: 'pending',
    });

    if (!forceRefresh) {
      const cached = getLatestSummaryForVideo(video.id);
      if (cached && video.status === 'done') {
        return res.json({ video, summary: JSON.parse(cached.summary_json), cached: true });
      }
    }

    // 1. Metadata (title, channel, duration, chapters if the creator added a timeline)
    setVideoStatus(video.id, 'downloading');
    const meta = await fetchMetadata(url);
    video = upsertVideo({
      youtube_id: youtubeId, url, title: meta.title, channel: meta.channel,
      duration_seconds: meta.duration_seconds, thumbnail_url: meta.thumbnail_url,
      status: 'downloading',
    });

    // 2. Audio download
    const audioPath = await downloadAudio(url, AUDIO_DIR, youtubeId);

    // 3. Transcription (local Whisper)
    setVideoStatus(video.id, 'transcribing');
    const { text, segments } = await transcribeAudio(audioPath);

    // 4. Summarization into sections/subsections (uses real chapters if present)
    setVideoStatus(video.id, 'summarizing');
    const summaryTree = await summarizeTranscript({
      title: meta.title, chapters: meta.chapters, segments,
    });

    // 5. Time-saved math
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const readingTimeSeconds = Math.round((wordCount / WORDS_PER_MINUTE) * 60);
    const timeSavedSeconds = Math.max(0, meta.duration_seconds - readingTimeSeconds);

    const summaryRow = insertSummary({
      video_id: video.id,
      summary_json: JSON.stringify(summaryTree),
      transcript_text: text,
      word_count: wordCount,
      reading_time_seconds: readingTimeSeconds,
      time_saved_seconds: timeSavedSeconds,
    });

    setVideoStatus(video.id, 'done');

    // Clean up the audio file, we don't need it once transcribed.
    fs.rm(audioPath, { force: true }, () => {});

    res.json({
      video: getVideoById(video.id),
      summary: summaryTree,
      reading_time_seconds: readingTimeSeconds,
      time_saved_seconds: timeSavedSeconds,
      cached: false,
    });
  } catch (err) {
    console.error(err);
    if (video) setVideoStatus(video.id, 'error', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/videos', (req, res) => {
  res.json(listVideosWithSummaries());
});

router.get('/videos/:id', (req, res) => {
  const video = getVideoById(req.params.id);
  if (!video) return res.status(404).json({ error: 'not found' });
  const summary = getLatestSummaryForVideo(video.id);
  res.json({
    video,
    summary: summary ? JSON.parse(summary.summary_json) : null,
    reading_time_seconds: summary?.reading_time_seconds,
    time_saved_seconds: summary?.time_saved_seconds,
  });
});

router.get('/stats', (req, res) => {
  res.json(getStats());
});

export default router;
