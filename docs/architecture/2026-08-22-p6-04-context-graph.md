# Agent Note: P6-04 — Context Graph & Retrieval Planner
## Problem
No unified context graph or retrieval planner with token budget.
## Contract
- ContextGraph: addNode, addEdge, getAncestors, getDescendants, getByRun, getByType
- RetrievalPlanner: planRetrieval with token budget
## State Machine
nodes → sort by relevance → budget-limited selection → plan
## Failure Semantics
- Budget exceeded: node excluded
- Unknown node: not found
## Rejection
- Node exceeding remaining budget: excluded
