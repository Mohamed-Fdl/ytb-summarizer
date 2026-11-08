const form = document.getElementById('summarize-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const statusBox = document.getElementById('status-box');
const resultBox = document.getElementById('result-box');

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'library') loadLibrary();
  });
});

// --- Summarize form ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  submitBtn.disabled = true;
  resultBox.classList.add('hidden');
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Fetching video info, downloading audio, transcribing, summarizing… this can take a couple of minutes for longer videos.';

  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    statusBox.classList.add('hidden');
    renderResult(data);
  } catch (err) {
    statusBox.textContent = `Error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

function formatDuration(totalSeconds) {
  if (!totalSeconds && totalSeconds !== 0) return '';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderResult(data) {
  const { video, summary, reading_time_seconds, time_saved_seconds } = data;

  const header = `
    <div class="video-header">
      ${video.thumbnail_url ? `<img src="${video.thumbnail_url}" alt="">` : ''}
      <div>
        <h2>${escapeHtml(video.title || 'Untitled')}</h2>
        <div class="meta">${escapeHtml(video.channel || '')} · ${formatDuration(video.duration_seconds)}</div>
      </div>
    </div>
  `;

  const banner = time_saved_seconds != null ? `
    <div class="time-saved-banner">
      ⏱️ Video is ${formatDuration(video.duration_seconds)} — reading this summary takes about
      ${formatDuration(reading_time_seconds)}. You saved roughly <strong>${formatDuration(time_saved_seconds)}</strong>.
    </div>
  ` : '';

  const sections = (summary.sections || []).map((section, i) => `
    <div class="section" data-index="${i}">
      <div class="section-header">
        <div>
          <span class="title">${escapeHtml(section.title)}</span>
          ${section.timestamp ? `<span class="timestamp">${escapeHtml(section.timestamp)}</span>` : ''}
        </div>
        <span class="chevron">▶</span>
      </div>
      <div class="subsections">
        <ul>
          ${(section.subsections || []).map(sub => `<li>${escapeHtml(sub.point)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `).join('');

  resultBox.innerHTML = header + banner + sections;
  resultBox.classList.remove('hidden');

  resultBox.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
  });

  // Open the first section by default
  resultBox.querySelector('.section')?.classList.add('open');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// --- Library ---
async function loadLibrary() {
  const [videos, stats] = await Promise.all([
    fetch('/api/videos').then(r => r.json()),
    fetch('/api/stats').then(r => r.json()),
  ]);

  const statsBox = document.getElementById('stats-box');
  statsBox.innerHTML = `
    <div class="stat-card">
      <div class="value">${stats.videos_count}</div>
      <div class="label">Videos summarized</div>
    </div>
    <div class="stat-card">
      <div class="value">${formatDuration(stats.total_video_seconds)}</div>
      <div class="label">Total video length</div>
    </div>
    <div class="stat-card">
      <div class="value">${formatDuration(stats.total_time_saved_seconds)}</div>
      <div class="label">Time saved</div>
    </div>
  `;

  const list = document.getElementById('library-list');
  list.innerHTML = videos.map(v => `
    <div class="library-item" data-id="${v.id}">
      ${v.thumbnail_url ? `<img src="${v.thumbnail_url}" alt="">` : ''}
      <div>
        <div class="title">${escapeHtml(v.title || v.url)}</div>
        <div class="meta">${escapeHtml(v.channel || '')} · ${formatDuration(v.duration_seconds)}</div>
      </div>
      <span class="status-pill ${v.status}">${v.status}</span>
    </div>
  `).join('') || '<p style="color:var(--muted)">No videos yet — summarize one to get started.</p>';

  list.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      const res = await fetch(`/api/videos/${id}`);
      const data = await res.json();
      if (!data.summary) return;
      document.querySelector('.tab-btn[data-tab="summarize"]').click();
      renderResult(data);
    });
  });
}
