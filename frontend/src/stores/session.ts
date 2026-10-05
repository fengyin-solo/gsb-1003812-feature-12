import { defineStore } from 'pinia'

import type { SeatProfile, SeatRole } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    seat: 'collector' as SeatRole,
    seatProfiles: {
      collector: { name: '采集登记员·王蕾', unit: '一号发掘区' },
      identifier: { name: '鉴定人·陈默', unit: '体质人类学实验室' },
      reviewer: { name: '复核人·刘衡', unit: '一号发掘区' },
    } as Record<SeatRole, SeatProfile>,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    activeSeatProfile: (state): SeatProfile => state.seatProfiles[state.seat],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setSeat(role: SeatRole) {
      this.seat = role
    },
  },
})
