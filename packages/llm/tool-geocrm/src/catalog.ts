/**
 * First-party GeoCRM Harness tools proxied by this package. Entity enums stay
 * open: GeoCRM ACL refuses an entity the caller cannot read or write.
 */

import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/** One model-facing GeoCRM tool. */
export interface GeoCrmToolSpec {
  /** Wire tool name, identical to GeoCRM Harness. */
  readonly name: string
  /** Model-facing description. */
  readonly description: string
  /** Implicit parameter object. */
  readonly parameters: ParameterSchemaSpec
  /** Presentation kind for the pending card. */
  readonly kind: 'search' | 'other'
}

const ENTITY = {
  type: 'string' as const,
  required: true as const,
  description: 'Entity key from list_entities. Do not invent names.',
}

const FILTERS = {
  type: 'object' as const,
  additionalProperties: true,
  description:
    'Filters keyed by column name. Exact match for filterable_fields. '
    + 'Virtual filters.us_region=east|west matches US sales territories on customers '
    + 'and customer_id entities. Rangeable columns accept column_gte / column_lt.',
}

const QUERY = {
  type: 'string' as const,
  description: 'Case-insensitive substring across searchable_fields. Omit to list.',
}

/** First-party CRM tools this Host registers. Upload tools are omitted. */
export const GEOCRM_TOOLS: readonly GeoCrmToolSpec[] = [
  {
    name: 'list_my_access',
    kind: 'search',
    description:
      'Return the signed-in GeoCRM role, groups, granted desktop modules, and write grants. '
      + 'Call this first to learn what the current session may read and write.',
    parameters: {},
  },
  {
    name: 'list_entities',
    kind: 'search',
    description:
      'List every GeoCRM data entity the caller may read, with searchable, filterable, and '
      + 'rangeable fields plus allowed write actions. Call this before search_records, '
      + 'summarize_records, or get_record.',
    parameters: {},
  },
  {
    name: 'search_records',
    kind: 'search',
    description:
      'Search or list rows of a GeoCRM entity. query matches searchable_fields from '
      + 'list_entities (for orders: BillNo/external_id and product_name, not company names). '
      + 'Prefer the default limit of 25. Results are restricted to the caller\'s groups.',
    parameters: {
      entity: ENTITY,
      query: QUERY,
      filters: FILTERS,
      order_by: { type: 'string', description: 'Column to sort by. Defaults to the entity recency column.' },
      ascending: { type: 'boolean', description: 'Sort ascending instead of descending. Defaults to false.' },
      limit: { type: 'integer', description: 'Rows to return. Keep this small; large pages waste context.' },
      offset: { type: 'integer', description: 'Rows to skip, for paging.' },
    },
  },
  {
    name: 'get_record',
    kind: 'search',
    description:
      'Fetch a single row by its UUID primary key (id_field from list_entities). '
      + 'Bill numbers, customer codes, emails, and SKUs are not ids — use search_records.',
    parameters: {
      entity: ENTITY,
      id: { type: 'string', required: true, description: 'UUID primary key. Not a BillNo or email.' },
    },
  },
  {
    name: 'count_records',
    kind: 'search',
    description: 'Count rows of a GeoCRM entity matching a search term and filters, without transferring the rows.',
    parameters: {
      entity: ENTITY,
      query: QUERY,
      filters: FILTERS,
    },
  },
  {
    name: 'summarize_records',
    kind: 'search',
    description:
      'Period report (week, month, quarter, half_year, year, or custom date_from/date_to) '
      + 'without transferring every row. Prefer this over paging search_records for reports.',
    parameters: {
      entity: ENTITY,
      period: {
        type: 'string',
        enum: ['week', 'month', 'quarter', 'half_year', 'year'],
        description: 'Preset window. Omit when using date_from and date_to.',
      },
      year: { type: 'integer', description: 'Calendar year, or ISO week-year when period is week.' },
      week: { type: 'integer', description: 'ISO week 1–53. Required when period is week.' },
      month: { type: 'integer', description: 'Month 1–12. Required when period is month.' },
      quarter: { type: 'integer', description: 'Quarter 1–4. Required when period is quarter.' },
      half: { type: 'integer', description: '1 = Jan–Jun, 2 = Jul–Dec. Required when period is half_year.' },
      date_from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD for a custom range.' },
      date_to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD for a custom range.' },
      timezone: { type: 'string', description: 'IANA timezone for calendar bounds. Defaults to Asia/Taipei.' },
      date_field: { type: 'string', description: 'Rangeable date column. Defaults to report_date_field from list_entities.' },
      group_by: { type: 'string', description: 'Extra breakdown column from filterable_fields. Do not use id.' },
      query: QUERY,
      filters: FILTERS,
      include_lines: { type: 'boolean', description: 'On orders, include top SKUs from line items. Defaults to true.' },
      top: { type: 'integer', description: 'How many customers, SKUs, and large orders to return.' },
    },
  },
  {
    name: 'create_record',
    kind: 'other',
    description:
      'Insert a new row. GeoCRM refuses the call unless the signed-in user holds an insert grant '
      + 'for that entity. New rows are forced into one of the caller\'s groups.',
    parameters: {
      entity: ENTITY,
      values: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'Column values for the new row.',
      },
    },
  },
  {
    name: 'update_record',
    kind: 'other',
    description:
      'Patch an existing row the caller can already read. GeoCRM refuses the call unless the '
      + 'signed-in user holds an update grant for that entity.',
    parameters: {
      entity: ENTITY,
      id: { type: 'string', required: true, description: 'UUID primary key of the row.' },
      values: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'Columns to change.',
      },
    },
  },
  {
    name: 'delete_record',
    kind: 'other',
    description:
      'Delete a row the caller can already read. GeoCRM refuses the call unless the signed-in '
      + 'user holds a delete grant for that entity.',
    parameters: {
      entity: ENTITY,
      id: { type: 'string', required: true, description: 'UUID primary key of the row.' },
    },
  },
]
