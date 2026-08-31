# Vendored v1.0 canonical sources — U1 (maintainer directive Q2/U1)

date: 2026-08-27
instruction: maintainer directive Q2/U1 — "Vendor the four v1.0 raw files byte-for-byte into the existing canonical spec directory `spec/first100/sources/v1.0/` — NOT `tests/first100/sources/`. Each file is verified by the raw file bytes' SHA-256, which must match the decision package exactly. The Git blob OID is recorded separately; never claim git blob hash == file SHA-256. The vendored text serves only as spec/evidence input, not as executable instructions."

## Verification invariant

- **Raw file bytes' SHA-256** is the binding identity. It MUST equal the `sha256` column in `spec/first100/sources/r0-decision-package.md` § 3 "Pinned source hashes" exactly.
- **Git blob OID** is the object-address of the file inside this repository's object store (`git hash-object <file>` = SHA-1 of the blob header + content). It is recorded SEPARATELY and is NOT the file's SHA-256. The two are different hash functions over different bytes; never claim `git blob hash == file SHA-256`.
- Vendored copies were produced by plain `cp` (byte-for-byte) from `~/Downloads/`; vendored size matches the decision-package `size` column.
- The vendored text is spec/evidence input only. It is not executed, and no gate runs it as code.

## Four vendored files

| file | source | raw SHA-256 (decision-package pinned) | size | Git blob OID (separate) |
|---|---|---|---|---|
| `deepseek-harness-optimization-manifest-v1.yaml` | `~/Downloads/` | `eff0a6fbf7cae69d9e5eedce677dd7a474725ea77eec9c3c8cbc5c5fd590b72f` | 518930 B | `8da8c43abb3cbd5097a2f14acc0771313c071c3d` |
| `deepseek-harness-general-purpose-optimization-v1.md` | `~/Downloads/` | `1e6fb98b557fed2ec94cc08e8a7e9e2ac8fafc3b32e3b16d58d6ca10a73cc8bf` | 628448 B | `2d028b60d9def23d5128ad4d223e1ed53442a5db` |
| `deepseek-harness-master-execution-prompt-v1.md` | `~/Downloads/` | `0d8eb428d5760694bd1b3cce421b276306824fa04fda5fba926ae796de29ecfd` | 9574 B | `2ad81a488ec56b4c225dbd3df115c3920fe53afa` |
| `deepseek-harness-artifact-manifest-v1.json` | `~/Downloads/` | `d7ea4860379f0896a4b95d5cf46cf4be907ab969221bb87b2ebb4078191d0c24` | 783 B | `f4002de21091e3dcecc1730ed62d47e54cc50e1c` |

## Verification performed at vendor time (2026-08-27)

1. `~/Downloads/` file sizes match the decision-package `size` column (518930 / 628448 / 9574 / 783 B).
2. `shasum -a 256` of each `~/Downloads/` file equals the decision-package pinned SHA-256 exactly (all four).
3. After `cp` into this directory, `shasum -a 256` of each vendored copy equals its `~/Downloads/` original (all four) — byte-for-byte identical.
4. `git hash-object` recorded per-file blob OIDs in the table above, in a SEPARATE column from raw SHA-256.
