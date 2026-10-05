import { createInboundItem } from '@/api/inbound'
import { moduleMeta } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, SeatContext, SeatRole } from '@/data/types'

// 人骨鉴定的席位流转：采集单位登记标本并安排送鉴 → 鉴定人判定性别/年龄/病理 →
// 复核人最终确认 → 归档。页面不做业务判断，所有鉴定动作都走这里。
const KEY = 'human_bone'
const meta = moduleMeta(KEY)

export const SEAT_OPTIONS: { role: SeatRole; label: string; hint: string }[] = [
  { role: 'collector', label: '采集单位', hint: '登记人骨标本、安排送鉴（限本单位标本）' },
  { role: 'identifier', label: '鉴定人', hint: '开始鉴定，提交性别、年龄与病理判定' },
  { role: 'reviewer', label: '复核人', hint: '复核确认（限本单位，确认后库房生成入库事项）、归档' },
]

const SEAT_LABEL: Record<SeatRole, string> = {
  collector: '采集单位',
  identifier: '鉴定人',
  reviewer: '复核人',
}

export const SEX_OPTIONS = ['男', '女', '无法判定']
export const AGE_OPTIONS = [
  '幼年（0-6岁）',
  '少年（7-14岁）',
  '青年（15-24岁）',
  '壮年（25-40岁）',
  '中年（41-60岁）',
  '老年（60岁以上）',
  '无法判定',
]

export type RegisterInput = {
  出土单位: string
  鉴定部位?: string
}

export type IdentificationInput = {
  性别判定: string
  年龄范围: string
  病理特征: string
  鉴定部位?: string
}

type ActionRule = { seat: SeatRole; from: string; to: string; sameUnit: boolean }

// 动作 → 席位与状态流转；送鉴、复核确认、归档要求席位单位与标本采集单位一致。
const ACTION_RULES: Record<string, ActionRule> = {
  安排送鉴: { seat: 'collector', from: '已采集', to: '已送鉴', sameUnit: true },
  开始鉴定: { seat: 'identifier', from: '已送鉴', to: '鉴定中', sameUnit: false },
  提交鉴定: { seat: 'identifier', from: '鉴定中', to: '已鉴定', sameUnit: false },
  复核确认: { seat: 'reviewer', from: '已鉴定', to: '已复核', sameUnit: true },
  归档: { seat: 'reviewer', from: '已复核', to: '已归档', sameUnit: true },
}

// 未成年个体的性别无法可靠判定：性别判定与年龄范围冲突时保留年龄范围结论。
const SUBADULT_PATTERN = /幼年|少年|未成年|儿童|婴幼儿/

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextSpecimenCode(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const match = /^HUMA-(\d+)$/.exec(String(row.标本编号 ?? ''))
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `HUMA-${String(max + 1).padStart(4, '0')}`
}

/** 当前席位在这条标本上能执行的动作。 */
export function actionsFor(row: EntryRow, seat: SeatRole): string[] {
  return Object.entries(ACTION_RULES)
    .filter(([, rule]) => rule.seat === seat && rule.from === String(row.status))
    .map(([action]) => action)
}

type Prepared =
  | { ok: true; rows: EntryRow[]; index: number; rule: ActionRule }
  | { ok: false; result: ActionResult }

function prepare(action: string, id: number, ctx: SeatContext): Prepared {
  const rule = ACTION_RULES[action]
  if (!rule) {
    return { ok: false, result: { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` } }
  }
  if (ctx.role !== rule.seat) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `「${action}」只能由${SEAT_LABEL[rule.seat]}席位执行，当前席位是「${SEAT_LABEL[ctx.role]}」`,
      },
    }
  }
  if (!ctx.name.trim()) {
    return { ok: false, result: { ok: false, message: '请先在席位栏填写席位人姓名' } }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, result: { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` } }
  }
  const current = String(rows[index].status)
  if (current !== rule.from) {
    const message =
      action === '复核确认' && (current === '已复核' || current === '已归档')
        ? `${meta.entity}已复核确认，重复确认已拦截，仅保留首次确认版本`
        : `${meta.entity}当前状态为「${current}」，不能执行「${action}」`
    return { ok: false, result: { ok: false, message } }
  }
  if (rule.sameUnit) {
    const unit = String(rows[index].采集单位 ?? '').trim()
    if (!unit) {
      return {
        ok: false,
        result: { ok: false, message: `${meta.entity}未登记采集单位，「${action}」无法核验单位归属` },
      }
    }
    if (unit !== ctx.unit.trim()) {
      return {
        ok: false,
        result: {
          ok: false,
          message: `席位所属单位「${ctx.unit}」与标本采集单位「${unit}」不一致，跨单位${action}已拦截`,
        },
      }
    }
  }
  return { ok: true, rows, index, rule }
}

function commit(rows: EntryRow[], index: number, patch: Partial<EntryRow>, to: string): EntryRow {
  const updated: EntryRow = {
    ...rows[index],
    ...patch,
    status: to,
    鉴定状态: to,
    pending: to !== meta.statuses[meta.statuses.length - 1],
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return updated
}

/** 采集单位席位登记新标本：编号自动生成，采集单位取席位所属单位。 */
export function registerSpecimen(input: RegisterInput, ctx: SeatContext): ActionResult {
  if (ctx.role !== 'collector') {
    return { ok: false, message: '登记人骨标本只能由采集单位席位执行' }
  }
  if (!ctx.name.trim()) {
    return { ok: false, message: '请先在席位栏填写席位人姓名' }
  }
  if (!ctx.unit.trim()) {
    return { ok: false, message: '请先在席位栏填写所属单位，标本需要登记采集单位' }
  }
  const 出土单位 = input.出土单位.trim()
  if (!出土单位) {
    return { ok: false, message: '出土单位不能为空' }
  }
  const rows = listRows(KEY)
  const row: EntryRow = {
    id: nextId(rows),
    status: '已采集',
    pending: true,
    abnormal: false,
    标本编号: nextSpecimenCode(rows),
    出土单位,
    采集单位: ctx.unit.trim(),
    性别判定: '',
    年龄范围: '',
    病理特征: '',
    鉴定人: '',
    复核人: '',
    鉴定状态: '已采集',
  }
  // 登记时鉴定部位可留空，鉴定环节再补录
  const 鉴定部位 = input.鉴定部位?.trim()
  if (鉴定部位) {
    row.鉴定部位 = 鉴定部位
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `${meta.entity}已登记，标本编号「${row.标本编号}」，当前状态「已采集」` }
}

/** 席位动作统一入口：送鉴 / 开始鉴定 / 提交鉴定 / 复核确认 / 归档。 */
export function runIdentificationAction(
  action: string,
  id: number,
  ctx: SeatContext,
  payload?: IdentificationInput,
): ActionResult {
  const prepared = prepare(action, id, ctx)
  if (!prepared.ok) {
    return prepared.result
  }
  const { rows, index, rule } = prepared
  switch (action) {
    case '安排送鉴':
      commit(rows, index, { 送鉴时间: now() }, rule.to)
      return { ok: true, message: `${meta.entity}已安排送鉴，当前状态「${rule.to}」` }
    case '开始鉴定':
      commit(rows, index, { 鉴定人: ctx.name }, rule.to)
      return { ok: true, message: `${meta.entity}开始鉴定，当前状态「${rule.to}」` }
    case '提交鉴定':
      return submitIdentification(rows, index, ctx, payload)
    case '复核确认': {
      // 复核结论直接覆盖在标本行上，重复确认只保留一个版本
      const updated = commit(rows, index, { 复核人: ctx.name, 复核时间: now() }, rule.to)
      const inbound = createInboundItem({
        标本编号: String(updated.标本编号),
        标本类别: '人骨标本',
        出土单位: String(updated.出土单位 ?? ''),
        采集单位: String(updated.采集单位 ?? ''),
        复核人: ctx.name,
      })
      const tail = inbound.created
        ? `，库房管理已生成标本入库事项「${inbound.item.事项编号}」`
        : `，入库事项「${inbound.item.事项编号}」已存在，未重复生成`
      return { ok: true, message: `${meta.entity}复核确认，当前状态「${rule.to}」${tail}` }
    }
    case '归档':
      commit(rows, index, {}, rule.to)
      return { ok: true, message: `${meta.entity}已归档` }
    default:
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
}

function submitIdentification(
  rows: EntryRow[],
  index: number,
  ctx: SeatContext,
  payload?: IdentificationInput,
): ActionResult {
  if (!payload) {
    return { ok: false, message: '提交鉴定需要填写性别判定、年龄范围与病理特征' }
  }
  const 性别判定 = payload.性别判定.trim()
  const 年龄范围 = payload.年龄范围.trim()
  const 病理特征 = payload.病理特征.trim()
  if (!性别判定) {
    return { ok: false, message: '请选择性别判定结论' }
  }
  if (!年龄范围) {
    return { ok: false, message: '请选择年龄范围' }
  }
  if (!病理特征) {
    return { ok: false, message: '请填写病理特征，无病变可填「未见明显病理」' }
  }
  // 性别判定与年龄范围冲突时保留年龄范围：未成年个体性别无法可靠判定
  let finalSex = 性别判定
  let note = ''
  if ((性别判定 === '男' || 性别判定 === '女') && SUBADULT_PATTERN.test(年龄范围)) {
    finalSex = '无法判定'
    note = '；性别判定与年龄范围冲突，未成年个体性别无法可靠判定，已保留年龄范围结论、性别判定记为「无法判定」'
  }
  const patch: Partial<EntryRow> = {
    性别判定: finalSex,
    年龄范围,
    病理特征,
    鉴定人: ctx.name,
    鉴定时间: now(),
  }
  // 旧标本缺少鉴定部位时兼容为空：不强制填写，填了才更新
  const 鉴定部位 = payload.鉴定部位?.trim()
  if (鉴定部位) {
    patch.鉴定部位 = 鉴定部位
  }
  commit(rows, index, patch, '已鉴定')
  return { ok: true, message: `${meta.entity}已提交鉴定，当前状态「已鉴定」${note}` }
}
