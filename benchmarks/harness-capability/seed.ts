/**
 * Seeds for the Harness capability benchmark (Epic P0-08). A run's seed
 * decides which recordings each lane draws, in what order, and every trial's
 * own seed, so the same seed reproduces the same trials (acceptance[1]).
 * @module benchmarks/harness-capability/seed
 */

/**
 * A deterministic 32-bit generator. Seeded explicitly so a trial's seed is the
 * whole of what a replay needs (must[2]); `Math.random` would make a recorded
 * seed unable to reproduce anything.
 * @param seed - the starting state.
 * @returns a function yielding the next value in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    // xorshift32: same sequence for the same seed on every platform.
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

/**
 * Derive one trial's seed. Deterministic in all three inputs so a report's
 * recorded seed identifies exactly one trial.
 * @param runSeed - the run's base seed.
 * @param scenario - the scenario name.
 * @param trial - the trial's index within its lane.
 * @returns the trial's seed.
 */
export function trialSeed(runSeed: number, scenario: string, trial: number): number {
  let hash = runSeed >>> 0
  for (const character of `${scenario}#${trial}`) {
    hash = (Math.imul(hash ^ character.charCodeAt(0), 0x0100_0193) >>> 0) || 1
  }
  return hash
}

/**
 * The scenarios one lane runs, in order: the lane's scenarios shuffled by the
 * run seed, taken in turn until `count` trials are drawn.
 * @param scenarios - the lane's scenarios.
 * @param count - how many trials to draw.
 * @param seed - the run seed.
 * @returns one scenario name per trial.
 */
export function drawScenarios(scenarios: readonly string[], count: number, seed: number): string[] {
  const random = seededRandom(seed)
  const order = [...scenarios]
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    const current = order[index]
    const picked = order[swap]
    if (current === undefined || picked === undefined) continue
    order[index] = picked
    order[swap] = current
  }
  return order.length === 0 ? [] : Array.from({ length: count }, (_, trial) => order[trial % order.length] as string)
}
