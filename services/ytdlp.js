import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

export function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  throw new Error('Could not extract a YouTube video ID from that URL');
}

// Fetch metadata (title, channel, duration, chapters) without downloading media
export async function fetchMetadata(url) {
  const { stdout } = await execFileAsync('yt-dlp', [
    '--dump-json',
    '--no-warnings',
    '--skip-download',
    url,
  ], { maxBuffer: 1024 * 1024 * 20 });

  const info = JSON.parse(stdout);
  return {
    youtube_id: info.id,
    title: info.title,
    channel: info.channel || info.uploader,
    duration_seconds: Math.round(info.duration || 0),
    thumbnail_url: info.thumbnail,
    // chapters: [{ title, start_time, end_time }] if the creator added a timeline, else []
    chapters: (info.chapters || []).map(c => ({
      title: c.title,
      start_time: c.start_time,
      end_time: c.end_time,
    })),
  };
}

// Download best audio track only, as mp3, into outDir. Returns the file path.
export async function downloadAudio(url, outDir, youtubeId) {
  fs.mkdirSync(outDir, { recursive: true });
  const outputTemplate = path.join(outDir, `${youtubeId}.%(ext)s`);

  await execFileAsync('yt-dlp', [
    '-x', '--audio-format', 'mp3',
    '--audio-quality', '5', // smaller file, plenty good enough for speech transcription
    '-o', outputTemplate,
    '--no-warnings',
    url,
  ], { maxBuffer: 1024 * 1024 * 20 });

  const finalPath = path.join(outDir, `${youtubeId}.mp3`);
  if (!fs.existsSync(finalPath)) {
    throw new Error('yt-dlp finished but the expected mp3 file was not found');
  }
  return finalPath;
}
