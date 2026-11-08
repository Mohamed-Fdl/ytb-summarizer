import { spawnSync } from 'node:child_process';

const MODE = process.env.CLAUDE_SUMMARIZE_MODE || 'claude-code'; // 'claude-code' | 'api'
const API_MODEL = 'claude-sonnet-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function formatTime(seconds) {
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor((seconds / 60) % 60).toString().padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function buildPromptInput({ chapters, segments }) {
  if (chapters && chapters.length > 0) {
    const chapterBlocks = chapters.map(ch => {
      const text = segments
        .filter(s => s.start >= ch.start_time && s.start < ch.end_time)
        .map(s => s.text)
        .join(' ');
      return `### Chapter: "${ch.title}" [${formatTime(ch.start_time)}-${formatTime(ch.end_time)}]\n${text}`;
    });
    return chapterBlocks.join('\n\n');
  }
  return segments.map(s => `[${formatTime(s.start)}] ${s.text}`).join('\n');
}

const SYSTEM_PROMPT = `You turn raw YouTube video transcripts into a structured outline.

Rules:
- Break the video into major sections (themes/topics actually discussed, not arbitrary time chunks).
- If the transcript is already split into chapters, respect those boundaries as your sections.
- Each section gets 2-6 subsections, each a short, concrete point (not a vague restatement of the title).
- Include the approximate start timestamp (mm:ss or h:mm:ss) for each section, taken from the transcript.
- Do not pad with filler ("the speaker also mentions..."); only include substantive points.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          timestamp: { type: 'string' },
          subsections: {
            type: 'array',
            items: {
              type: 'object',
              properties: { point: { type: 'string' } },
              required: ['point'],
            },
          },
        },
        required: ['title', 'subsections'],
      },
    },
  },
  required: ['sections'],
};

// --- Path 1 (default): shell out to the Claude Code CLI, authenticated with your
// Claude subscription (claude login). No API key needed, no per-token billing;
// draws from your plan's usage limits like any other Claude Code usage. ---
function summarizeViaClaudeCode({ title, chapters, segments }) {
  const transcriptText = buildPromptInput({ chapters, segments });
  const userPrompt = `Video title: "${title}"\n\nTranscript:\n${transcriptText}`;

  const result = spawnSync('claude', [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
    '--system-prompt', SYSTEM_PROMPT,
    '--allowedTools', '', // pure text generation, no file/bash tool access needed
    '--max-turns', '1',
  ], {
    input: userPrompt,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 50,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        "Claude Code CLI not found. Install it with 'npm install -g @anthropic-ai/claude-code' " +
        "and run 'claude login' once, or set CLAUDE_SUMMARIZE_MODE=api to use an API key instead."
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`claude -p exited with code ${result.status}: ${result.stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`Could not parse claude -p output as JSON: ${e.message}`);
  }
  if (parsed.is_error) {
    throw new Error(`Claude Code reported an error: ${parsed.result || 'unknown error'}`);
  }
  if (!parsed.structured_output) {
    throw new Error('claude -p did not return structured_output; got: ' + JSON.stringify(parsed).slice(0, 300));
  }
  return parsed.structured_output;
}

// --- Path 2 (opt-in): raw Anthropic API call, billed per-token to ANTHROPIC_API_KEY.
// Set CLAUDE_SUMMARIZE_MODE=api to use this instead. ---
async function summarizeViaApi({ title, chapters, segments }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in your environment (.env)');

  const transcriptText = buildPromptInput({ chapters, segments });
  const userPrompt = `Video title: "${title}"\n\nTranscript:\n${transcriptText}\n\nRespond with ONLY valid JSON matching this shape, no markdown fences, no preamble:\n${JSON.stringify(OUTPUT_SCHEMA)}`;

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: API_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  const textBlock = data.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text content in Claude response');
  const cleaned = textBlock.text.replace(/^```json\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

export async function summarizeTranscript({ title, chapters, segments }) {
  if (MODE === 'api') return summarizeViaApi({ title, chapters, segments });
  return summarizeViaClaudeCode({ title, chapters, segments });
}
