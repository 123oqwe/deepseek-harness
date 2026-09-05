---
description: "Shared structured-fact board for Epic P5-11: a fact is a structured value or an artifact reference, never free prose, and every fact traces back to the observations that produced it."
kind: "package-reference"
---

# @deepseek-ai/dsh-blackboard

English | [中文](README.zh.md)

## Summary

A blackboard is where several agents put what they have found so others can build on it. `admitFact` decides what may be written; `traceToObservations` answers where a fact came from.

## A fact is structured, or it is a reference

`admitFact` refuses free prose. A board that accepts a sentence becomes a chat log that several agents read as though it were data, and the first consumer to parse it decides what it meant. A structured value or an artifact reference has one reading.

The check is a runtime one because the writer may be a model, and a model's output reaches this boundary as JSON rather than as a typed value.

## Every fact traces to observations

`traceToObservations` walks a fact back to what produced it. A board without that is a set of claims with no provenance, and an agent reading one cannot tell a measurement from an inference another agent made two hops ago.

## Model Experience

None, as this package exports fact admission, observation tracing, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No retention policy.** Facts accumulate; nothing here expires, compacts, or bounds a board.
- **Trust is uniform.** A fact from any writer is admitted on the same terms; per-writer trust levels would need an identity the board does not currently carry.
