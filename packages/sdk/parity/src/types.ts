export interface SchemaField {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly defaultValue?: unknown
}

export interface SchemaDefinition {
  readonly version: string
  readonly fields: readonly SchemaField[]
}

export interface ParityCheckResult {
  readonly sdk: string
  readonly version: string
  readonly fieldsMatched: number
  readonly fieldsMismatched: number
  readonly mismatches: readonly { field: string; expected: string; actual: string }[]
  readonly passed: boolean
}
