import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 跨模块入库事项与库房架位共用本地数据层，但单独存放：这是「人骨鉴定 → 库房管理」的联动结果。
export const STORAGE_INBOUND_KEY = 'storage_inbound'

export const INBOUND_STATUSES = {
  waiting: '待入库',
  done: '已入库',
} as const

export function listInboundItems(): EntryRow[] {
  return listRows(STORAGE_INBOUND_KEY)
}

function formatTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// 复核确认时调用：按标本编号幂等生成入库事项，重复确认只留下一个版本，不会产生两条。
export function ensureInboundItem(input: {
  specimenId: string
  collectorUnit: string
  reviewer: string
  conclusion: string
}): ActionResult {
  const rows = listInboundItems()
  if (rows.some((row) => String(row['标本编号']) === input.specimenId)) {
    return { ok: true, message: `标本 ${input.specimenId} 的入库事项已存在，未重复生成` }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: INBOUND_STATUSES.waiting,
    pending: true,
    abnormal: false,
    标本编号: input.specimenId,
    采集单位: input.collectorUnit,
    复核人: input.reviewer,
    鉴定结论: input.conclusion,
    架位编号: '',
    管理人: '',
    入库时间: '',
  }
  saveRows(STORAGE_INBOUND_KEY, [...rows, row])
  return { ok: true, message: `已向库房管理生成标本 ${input.specimenId} 的入库事项` }
}

// 库房管理员（复用库房管理动作）落实入库。
export function completeInbound(id: number, shelf: string, keeper: string): ActionResult {
  const rows = listInboundItems()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的入库事项` }
  }
  const current = rows[index]
  if (String(current.status) === INBOUND_STATUSES.done) {
    return { ok: false, message: '该入库事项已完成，无需重复办理' }
  }
  if (!shelf.trim()) {
    return { ok: false, message: '请填写入库架位编号' }
  }
  const next: EntryRow = {
    ...current,
    status: INBOUND_STATUSES.done,
    pending: false,
    架位编号: shelf.trim(),
    管理人: keeper.trim(),
    入库时间: formatTime(new Date()),
  }
  const updated = [...rows]
  updated[index] = next
  saveRows(STORAGE_INBOUND_KEY, updated)
  return { ok: true, message: `标本 ${next['标本编号']} 已登记入库到架位 ${shelf.trim()}` }
}
