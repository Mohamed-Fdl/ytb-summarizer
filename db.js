import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'library.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_id TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    channel TEXT,
    duration_seconds INTEGER,
    thumbnail_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | downloading | transcribing | summarizing | done | error
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    summary_json TEXT NOT NULL,      -- structured sections/subsections tree
    transcript_text TEXT,            -- full transcript, kept for re-summarizing later
    word_count INTEGER,
    reading_time_seconds INTEGER,
    time_saved_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function upsertVideo(video) {
  const stmt = db.prepare(`
    INSERT INTO videos (youtube_id, url, title, channel, duration_seconds, thumbnail_url, status)
    VALUES (@youtube_id, @url, @title, @channel, @duration_seconds, @thumbnail_url, @status)
    ON CONFLICT(youtube_id) DO UPDATE SET
      title = excluded.title,
      channel = excluded.channel,
      duration_seconds = excluded.duration_seconds,
      thumbnail_url = excluded.thumbnail_url,
      status = excluded.status,
      error_message = NULL
    RETURNING *;
  `);
  return stmt.get(video);
}

export function setVideoStatus(id, status, errorMessage = null) {
  db.prepare(`UPDATE videos SET status = ?, error_message = ? WHERE id = ?`)
    .run(status, errorMessage, id);
}

export function getVideoByYoutubeId(youtubeId) {
  return db.prepare(`SELECT * FROM videos WHERE youtube_id = ?`).get(youtubeId);
}

export function getVideoById(id) {
  return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id);
}

export function insertSummary(row) {
  const stmt = db.prepare(`
    INSERT INTO summaries (video_id, summary_json, transcript_text, word_count, reading_time_seconds, time_saved_seconds)
    VALUES (@video_id, @summary_json, @transcript_text, @word_count, @reading_time_seconds, @time_saved_seconds)
    RETURNING *;
  `);
  return stmt.get(row);
}

export function getLatestSummaryForVideo(videoId) {
  return db.prepare(`
    SELECT * FROM summaries WHERE video_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(videoId);
}

export function listVideosWithSummaries() {
  return db.prepare(`
    SELECT v.*, s.id as summary_id, s.time_saved_seconds, s.reading_time_seconds, s.created_at as summarized_at
    FROM videos v
    LEFT JOIN (
      SELECT * FROM summaries GROUP BY video_id HAVING MAX(created_at)
    ) s ON s.video_id = v.id
    ORDER BY v.created_at DESC
  `).all();
}

export function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT v.id) as videos_count,
      COALESCE(SUM(v.duration_seconds), 0) as total_video_seconds,
      COALESCE(SUM(s.time_saved_seconds), 0) as total_time_saved_seconds
    FROM videos v
    LEFT JOIN summaries s ON s.video_id = v.id
    WHERE v.status = 'done'
  `).get();
  return row;
}

export default db;
