export interface DeleteResult {
  readonly deleted: string[]
  readonly failed: string[]
  readonly retained: string[]
}

export function deleteSessions(ids: string[], deleteFn: (id: string) => boolean): DeleteResult {
  const deleted: string[] = []
  const failed: string[] = []
  for (const id of ids) {
    if (deleteFn(id)) {
      deleted.push(id)
    } else {
      failed.push(id)
    }
  }
  return { deleted, failed, retained: [] }
}

export function partialRepair<T>(records: T[], repairFn: (record: T) => T | null): { repaired: T[]; dropped: number } {
  const repaired: T[] = []
  let dropped = 0
  for (const record of records) {
    const result = repairFn(record)
    if (result !== null) {
      repaired.push(result)
    } else {
      dropped++
    }
  }
  return { repaired, dropped }
}
