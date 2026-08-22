## Remaining Risks (P4-11)
1. Integration with LLM adapter retry and workflow retry requires code changes to existing adapters — deferred to integration phase.
2. Hedge exclusion (preventing concurrent hedged requests) needs integration with Run scheduler (P4-10).
3. Real provider failure testing with live APIs — marked NOT_RUN.
4. Retry-After header parsing from real HTTP responses — tested at classification level only.
