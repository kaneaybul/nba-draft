Draft pipeline recovery notes

These draft files were reconstructed from session history after the original
`script/draft`, `processed/draft`, and `ref/scvardraft.csv` contents were lost.

What is restored:
- The core draft scripts in `script/draft/`
- A scaffold `ref/scvardraft.csv`
- This `processed/draft/` folder so outputs can be written here again

What is not fully recoverable from chat history alone:
- The exact prior generated CSV outputs
- The exact final contents of `ref/scvardraft.csv`
- Any deleted source CSVs that were never printed in full

Current state:
- The reconstructed scripts parse successfully in R
- They are best-effort recreations, not guaranteed byte-identical copies
- Generated outputs will need to be recreated by rerunning the pipeline once
  the required source CSVs are available again

Recommended next steps:
1. Restore any missing draft source CSVs from backups, Recycle Bin, or IDE history.
2. Refill `ref/scvardraft.csv` with the intended shot-creation data.
3. Rerun `script/draft/draft_unified_pipeline.R`.
