# Capabilities and limits

Every tool the brain can call, the QVAC model behind it, and what it accepts. All inference runs on this computer through the pinned `@qvac/sdk` 0.22.0.

## Tools

| Tool | Model (catalog entry) | Input | Notes |
|---|---|---|---|
| `transcribe_audio` | Whisper tiny English (`cap-stt`) | WAV, up to 60 min | Fast; English only |
| `meeting_notes` | Sortformer 4-speaker (`diarize`) → Whisper small (`stt-small`) → brain | WAV, up to 60 min | Up to four anonymous speakers; also saves a Markdown file |
| `read_image_text` | EasyOCR Latin + CRAFT detector (`cap-ocr`) | PNG/JPEG, ≤ 16 MP | Small symbols and digits can be misread |
| `look_at_image` | Vision brain (`brain-vision`), else QVAC VisionPsy (`visionpsy`) | PNG/JPEG | |
| `extract_fields` | Vision brain with a JSON schema, else OCR or document text plus the brain | Image, PDF, Word, text | Missing fields come back empty, never guessed; saves a CSV |
| `classify_image` | MobileNet bundled with the SDK | PNG/JPEG | Labels only food / report / other |
| `decode_brain_signals` | BCI Whisper + embedder (`cap-bci`) | QVAC BCI `.bin` recording | Needs the recording's session day index; research decoding, not medical |
| `speak` | Supertonic English (`cap-tts`) | Text, ≤ 1,500 characters | Mono PCM16 WAV, ≤ 120 s |
| `decide` | LAYA typed decisions (`cap-decide`) | Situation, question, 2–8 options | Advisory probabilities; nothing is executed |
| `analyze_table` | — (computed in code) | CSV, ≤ 5,000 rows × 40 columns | Exact sums, ranges and group totals |
| `translate_text` | Bergamot pairs (`translate-*`); QVAC TranslatePsy AfriSLM for African languages | Text | Non-English pairs pivot through English |
| `search_vault` | EmbeddingGemma 300M (`embed`) | Query | Searches every document, transcript and OCR result |
| `ask_medical_model` | QVAC MedPsy (`medpsy`, `medpsy-4b`) | Question | Educational information, not diagnosis |
| `generate_image` | FLUX.2 klein 4B + VAE, Qwen3 4B text encoder (`image`) | Prompt | About a minute per image; the brain is unloaded first |
| `generate_music` | ACE-Step 1.5 turbo (`music`) | Description, 5–30 s | Instrumental only |
| `search_files`, `show_ui`, `save_document`, `use_skill`, `create_flow`, `run_flow`, `list_flows` | — | | Local helpers |

Connector and MCP tools are listed in Settings → Connectors and Settings → MCP.

## Attachments

- **Audio:** WAV is used as is. MP3, M4A, AAC, OGG, Opus, WebM and FLAC are converted to 16 kHz mono WAV in the browser before upload.
- **Images:** PNG and JPEG are checked against their real headers and limited to 8,192 px per side and 16 MP.
- **Documents:** PDF (text layer, up to 300 pages; scanned PDFs need OCR on page images), Word `.docx`, CSV, TXT, Markdown, JSON.
- **BCI:** two little-endian `uint32` values (timesteps, channels), then row-major finite `float32` features; at most 2,900 timesteps.
- **Size:** uploads are limited to 128 MiB. Binary inputs are stored in the private workspace with `0600` permissions; capability runs use temporary copies that are deleted afterwards.

## Model loading and memory

- The brain stays loaded between messages. Capability, specialist and support models load per call and unload afterwards. Heavy pipelines run one at a time.
- Before image or music generation the brain is unloaded, so two large models never share memory. The app refuses brains whose weights need more than about 70 % of system memory.
- Catalog downloads use QVAC registry constants or pinned Hugging Face URLs, verified by SHA-256 by the SDK. Weights live in one shared cache (`.local/qvac-cache`, or `QVAC_UI_MODEL_CACHE`).
- Local OCR needs an explicit detector path; the catalog sets it. The SDK's `ggml-ocr` accepts GGUF recognizer and detector files only.

## Cancellation

Stopping a message aborts the chat turn and the running tool. Transcription, BCI, TTS, decisions and model loads are cancelled through their SDK request ids. In this SDK version OCR and classification cannot be interrupted mid-pass: the app discards their result and keeps the lock until the native call and unload finish.

## Evidence

- `verification/native-harness.json`: end-to-end scenarios on real models (`npm run test:native-harness`).
- `verification/native-generation.json`: image and music generation, two runs each (`node scripts/test-generation.mjs`, which downloads the weights to a temporary cache and deletes them afterwards).
- `verification/native-stt.json`, `native-ocr-invoice.json`, `native-both-smoke.json`, `native-cancellation.json`, `decision-sample.json`: earlier per-capability native checks (speech-to-text, OCR, TTS and decisions, cancellation).
- `verification/native-voice.json` and `voice-response.wav`: the earlier voice pipeline's run, kept for reference.

These show that pipelines run correctly on the development machine (macOS, Apple Silicon). They are not accuracy benchmarks.
