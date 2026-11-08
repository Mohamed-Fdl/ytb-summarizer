#!/usr/bin/env python3
"""
Transcribes an audio file locally using faster-whisper and prints JSON to stdout:
{
  "text": "full transcript...",
  "segments": [{"start": 0.0, "end": 4.2, "text": "..."}, ...]
}

Usage: python3 transcribe.py <audio_file_path> [model_size]
model_size defaults to "small" (good speed/accuracy tradeoff on CPU).
Use "base" for faster/rougher, "medium" for slower/more accurate.
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "audio file path required"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "small"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper not installed. Run: pip install faster-whisper"
        }))
        sys.exit(1)

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(audio_path, beam_size=5)

    segments = []
    full_text_parts = []
    for seg in segments_iter:
        segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
        full_text_parts.append(seg.text.strip())

    result = {
        "language": info.language,
        "text": " ".join(full_text_parts),
        "segments": segments,
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
