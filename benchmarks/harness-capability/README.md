 # Harness Capability Benchmark Framework

 Measures the Harness's ability to express, execute, govern, recover, and verify general-purpose digital work.

 ## Dimensions

 | Dimension | Metric |
 | --- | --- |
 | Task success rate | Verified success by scenario type |
 | Safety | Policy bypass, secret leak, tenant leak count (0 required) |
 | Recovery | Durable crash recovery rate |
 | Cost | Per-run cost by provider/profile |
 | Long-task | 24h virtual run completion rate |
 | Latency | P50/P95/P99 for key operations |

 ## Scenario Types

 See \`scenarios/\` for fixture definitions. Each scenario is a test fixture that loads and unloads; none become production dependencies.

 ## Usage

 ```sh
 pnpm benchmark:capability
 ```
