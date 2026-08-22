 # Remaining Risks — P0-01

 1. The manifest's audit SHA `b150a551` does not exist in the local clone. The local HEAD `47f943859b` is used instead. If the manifest's SHA exists in a different branch or the upstream has diverged, the fingerprint may need to be re-captured.

 2. The fingerprint covers 6 schema files and 3 manifest files. If new schema or protocol files are added in future issues, the `SCHEMA_FILES` list in `baseline-fingerprint.mjs` must be updated and `baseline:capture` re-run.

 3. Workspace package versions are not compared (only names). Version bumps alone do not trigger drift; this is intentional to avoid noise during normal development.

 4. Cross-platform fingerprint equality (Linux vs macOS) depends on consistent line endings. Git's autocrlf settings could affect this; the repo uses `.gitattributes` to manage line endings.
