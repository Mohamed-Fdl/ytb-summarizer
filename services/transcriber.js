import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Returns { language, text, segments: [{start, end, text}] }
export async function transcribeAudio(audioPath, modelSize = 'small') {
  const scriptPath = path.join(__dirname, 'transcribe.py');
  const { stdout } = await execFileAsync(
    'python3',
    [scriptPath, audioPath, modelSize],
    { maxBuffer: 1024 * 1024 * 100, timeout: 1000 * 60 * 30 } // up to 30 min
  );

  const result = JSON.parse(stdout);
  if (result.error) throw new Error(result.error);
  return result;
}
