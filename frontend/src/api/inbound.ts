import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 库房管理的「标本入库事项」：由人骨鉴定复核确认跨模块生成，同一标本只保留一条，
// 重复确认不会堆出第二个版本。
export const INBOUND_KEY = 'storage_inbound'

export type InboundInput = {
  标本编号: string
  标本类别: string
  出土单位: string
  采集单位: string
  复核人: string
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function listInboundItems(): EntryRow[] {
  return listRows(INBOUND_KEY)
}

export function createInboundItem(input: InboundInput): { created: boolean; item: EntryRow } {
  const rows = listRows(INBOUND_KEY)
  const existing = rows.find(
    (row) => row.标本编号 === input.标本编号 && row.标本类别 === input.标本类别,
  )
  if (existing) {
    return { created: false, item: existing }
  }
  const id = nextId(rows)
  const item: EntryRow = {
    id,
    status: '待入库',
    pending: true,
    abnormal: false,
    事项编号: `INB-${String(id).padStart(4, '0')}`,
    ...input,
    生成时间: now(),
  }
  saveRows(INBOUND_KEY, [...rows, item])
  return { created: true, item }
}

export function completeInboundItem(id: number): ActionResult {
  const rows = listRows(INBOUND_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的入库事项` }
  }
  if (rows[index].status === '已入库') {
    return { ok: false, message: `入库事项「${rows[index].事项编号}」已办理，不用重复操作` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: '已入库', pending: false }
  saveRows(INBOUND_KEY, next)
  return { ok: true, message: `入库事项「${rows[index].事项编号}」已办理入库` }
}
