/**
 * The one place that answers "which files did this epic actually touch?".
 *
 * Two tools need the answer and they must not each grow their own, which is
 * the defect BLOCKED-136 recorded about the consumer dedup rule: one rule,
 * written twice, by two owners, each aware of the other.
 *
 * **The answer is not `files[]`.** BLOCKED-134 measured that a stage's
 * declared `files` is a sketch of the principal deliverables rather than a
 * scope boundary — 79 of 116 live freeze entries cite a file outside it. A
 * check computed from `files[]` alone therefore reports "this epic never
 * touched X" for an X the epic really did touch, and, used to decide whether a
 * CI failure is unrelated to an epic, it would be true whether or not the epic
 * caused the failure. That is a check that cannot fail, and BLOCKED-137 is the
 * record of what that shape costs when it guards an admission.
 *
 * @module scripts/first100/epic-reality-set
 */

/**
 * Every file an epic touched: its declaration plus its live freeze entries.
 *
 * Superseded freeze entries are excluded — they describe a shape the epic no
 * longer promises, and counting their files would widen the set with work that
 * was replaced.
 * @param epic - the registry row, carrying `id`, `files[]` and `stages`.
 * @param freeze - all command-freeze entries, superseded ones included; they are filtered here.
 * @returns repo-relative paths, deduplicated, in insertion order.
 */
export function realitySet(epic, freeze) {
  const paths = new Set()
  for (const file of epic.files ?? []) paths.add(file.path)
  for (const stage of Object.values(epic.stages ?? {})) {
    for (const path of stage?.files ?? []) paths.add(path)
  }
  for (const entry of freeze) {
    if (entry.epic !== epic.id || entry.supersededBy !== undefined) continue
    for (const path of entry.files ?? []) paths.add(path)
  }
  return [...paths]
}

/**
 * The paths in an epic's reality set that a failure's subject paths reach.
 *
 * Matching is by path prefix or containment rather than equality, because a
 * failure names the file it failed in while a reality set names files, whole
 * directories, and the packages that contain them. An empty result is what
 * licenses calling a failure unrelated to this epic; a non-empty one names
 * exactly what makes that claim false.
 * @param epicPaths - the epic's reality set, from {@link realitySet}.
 * @param subjectPaths - the repo-relative paths the failing cases are about.
 * @returns the intersecting pairs, `{ subject, declared }`, empty when disjoint.
 */
export function realitySetOverlap(epicPaths, subjectPaths) {
  const overlap = []
  for (const subject of subjectPaths) {
    for (const declared of epicPaths) {
      if (subject === declared || subject.startsWith(`${declared}/`) || declared.startsWith(`${subject}/`) || declared.includes(subject)) {
        overlap.push({ subject, declared })
      }
    }
  }
  return overlap
}
