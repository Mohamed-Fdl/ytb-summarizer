#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractYoutubeId, fetchMetadata, downloadAudio } from './services/ytdlp.js';
import { transcribeAudio } from './services/transcriber.js';
import { summarizeTranscript } from './services/summarizer.js';
import {
  upsertVideo, setVideoStatus, getVideoById,
  insertSummary, getLatestSummaryForVideo, listVideosWithSummaries, getStats,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, 'data', 'audio');
const WORDS_PER_MINUTE = 220;

const c = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};

function formatDuration(totalSeconds) {
  if (totalSeconds == null) return '';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function printSummary(video, summaryTree, readingTimeSeconds, timeSavedSeconds) {
  console.log('\n' + c.bold(video.title || video.url));
  console.log(c.dim(`${video.channel || ''} · ${formatDuration(video.duration_seconds)}`));

  if (timeSavedSeconds != null) {
    console.log(
      c.green(`\n⏱ You saved about ${formatDuration(timeSavedSeconds)} ` +
      `(video ${formatDuration(video.duration_seconds)} vs. ~${formatDuration(readingTimeSeconds)} to read this)`)
    );
  }

  for (const section of summaryTree.sections || []) {
    const ts = section.timestamp ? c.cyan(`[${section.timestamp}]`) : '';
    console.log(`\n${c.bold('▸ ' + section.title)} ${ts}`);
    for (const sub of section.subsections || []) {
      console.log(`    - ${sub.point}`);
    }
  }
  console.log('');
}

async function runSummarize(url, { forceRefresh, modelSize }) {
  const youtubeId = extractYoutubeId(url);
  let video = upsertVideo({
    youtube_id: youtubeId, url, title: null, channel: null,
    duration_seconds: null, thumbnail_url: null, status: 'pending',
  });

  if (!forceRefresh) {
    const cached = getLatestSummaryForVideo(video.id);
    if (cached && video.status === 'done') {
      console.log(c.dim('(cached — pass --refresh to redo it)'));
      printSummary(video, JSON.parse(cached.summary_json), cached.reading_time_seconds, cached.time_saved_seconds);
      return;
    }
  }

  try {
    process.stdout.write(c.dim('fetching video info... '));
    setVideoStatus(video.id, 'downloading');
    const meta = await fetchMetadata(url);
    video = upsertVideo({
      youtube_id: youtubeId, url, title: meta.title, channel: meta.channel,
      duration_seconds: meta.duration_seconds, thumbnail_url: meta.thumbnail_url,
      status: 'downloading',
    });
    console.log(c.green('done'));

    process.stdout.write(c.dim('downloading audio... '));
    const audioPath = await downloadAudio(url, AUDIO_DIR, youtubeId);
    console.log(c.green('done'));

    process.stdout.write(c.dim(`transcribing (whisper: ${modelSize})... `));
    setVideoStatus(video.id, 'transcribing');
    const { text, segments } = await transcribeAudio(audioPath, modelSize);
    console.log(c.green('done'));

    process.stdout.write(c.dim('summarizing... '));
    setVideoStatus(video.id, 'summarizing');
    const summaryTree = await summarizeTranscript({ title: meta.title, chapters: meta.chapters, segments });
    console.log(c.green('done'));

    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const readingTimeSeconds = Math.round((wordCount / WORDS_PER_MINUTE) * 60);
    const timeSavedSeconds = Math.max(0, meta.duration_seconds - readingTimeSeconds);

    insertSummary({
      video_id: video.id,
      summary_json: JSON.stringify(summaryTree),
      transcript_text: text,
      word_count: wordCount,
      reading_time_seconds: readingTimeSeconds,
      time_saved_seconds: timeSavedSeconds,
    });
    setVideoStatus(video.id, 'done');
    fs.rm(audioPath, { force: true }, () => {});

    printSummary(getVideoById(video.id), summaryTree, readingTimeSeconds, timeSavedSeconds);
  } catch (err) {
    console.log(c.yellow('failed'));
    setVideoStatus(video.id, 'error', err.message);
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  }
}

function runLibrary() {
  const videos = listVideosWithSummaries();
  if (videos.length === 0) {
    console.log(c.dim('No videos summarized yet.'));
    return;
  }
  for (const v of videos) {
    const pill = v.status === 'done' ? c.green(v.status) : v.status === 'error' ? c.yellow(v.status) : c.dim(v.status);
    console.log(`#${v.id}  ${c.bold(v.title || v.url)}  ${c.dim(formatDuration(v.duration_seconds))}  ${pill}`);
  }
}

function runStats() {
  const stats = getStats();
  console.log(`Videos summarized: ${c.bold(stats.videos_count)}`);
  console.log(`Total video length: ${c.bold(formatDuration(stats.total_video_seconds))}`);
  console.log(`Total time saved:   ${c.green(c.bold(formatDuration(stats.total_time_saved_seconds)))}`);
}

function printHelp() {
  console.log(`
${c.bold('yt-summarize')} — summarize a YouTube video locally, track time saved

Usage:
  yt-summarize <youtube-url> [--refresh] [--model <size>]
  yt-summarize library
  yt-summarize stats

Options:
  --refresh        re-run the pipeline even if this video was already summarized
  --model <size>   whisper model size: tiny | base | small | medium | large-v3 (default: small)

Summarization uses your Claude Code subscription (claude -p) by default.
Set CLAUDE_SUMMARIZE_MODE=api and ANTHROPIC_API_KEY to use the paid API instead.
`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    refresh: { type: 'boolean', default: false },
    model: { type: 'string', default: 'small' },
  },
});

const [command] = positionals;

if (!command || command === 'help' || command === '--help') {
  printHelp();
} else if (command === 'library') {
  runLibrary();
} else if (command === 'stats') {
  runStats();
} else {
  // Treat the positional as a YouTube URL
  await runSummarize(command, { forceRefresh: values.refresh, modelSize: values.model });
}
