# P0-06 Remaining Risks

- The schema registry is initialized at boot but built-in schemas use static version 0.1; real schema versioning will evolve with the codebase.
- No migration paths registered yet for built-in schemas; migrations will be added as schemas evolve in later waves.
- The registry is a process-local singleton; cross-process schema negotiation requires P8-01 (Protocol Version Negotiation).
