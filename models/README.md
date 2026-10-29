# models/

You don't need to put anything here. Catalog models download from the QVAC registry into the shared cache (`.local/qvac-cache`) from **Settings → Models**.

Use this folder for **your own GGUF chat models**: any `*.gguf` file placed here with a matching `*.gguf.receipt.json` (any JSON describing where it came from) appears under Settings → Models → Your own GGUF. You can also enter an absolute path to a GGUF anywhere on disk.

Weights (`*.gguf`, `*.bin`) and receipts are git-ignored. The license and model-card files here belong to models the app uses by default: Qwen, Whisper, Supertonic and LAYA.
