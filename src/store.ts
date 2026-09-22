// store.ts —— 状态层
// 维护工单与封存位的唯一数据源，全部数据只写入浏览器 localStorage，刷新后保留。
// 规则全部委托给 rules.ts；动作只有在规则返回 ok 时才提交，失败时状态不变。

import { useEffect, useState } from "react";
import {
  SLOT_COUNT,
  addDamage as addDamageRule,
  addOrder as addOrderRule,
  changeEdgeAngle,
  confirmPickup,
  setEdgeReviewed,
  toggleDamageRepaired,
  trySeal,
  type NewOrderDraft,
  type Result,
  type Slot,
  type State,
  type WorkOrder,
} from "./rules";

const STORAGE_KEY = "hxyfront-62004-seal-workbench-v1";

export function todayString(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function seed(): State {
  const slots: Slot[] = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    id: i + 1,
    orderId: null,
  }));

  const orders: WorkOrder[] = [
    {
      id: "ORD-201",
      customer: "林雪",
      board: "Burton Custom 156",
      boardType: "公园板",
      edgeAngle: "侧刃88° / 底刃1°",
      edgeReviewed: true,
      damages: [
        { id: "d-201-1", location: "板头左侧划痕", lengthCm: 8, repaired: true },
      ],
      slotId: null,
      sealCode: null,
      pickupContact: "",
      pickupDate: "",
      createdAt: "2026-09-18",
      sealedAt: null,
      pickedAt: null,
      history: [
        { at: "2026-09-18", text: "工单开立，进入修补流程" },
        { at: "2026-09-20", text: "损伤「板头左侧划痕」修补完成" },
        { at: "2026-09-21", text: "刃角复核通过（侧刃88° / 底刃1°）" },
      ],
    },
    {
      id: "ORD-202",
      customer: "张竞",
      board: "Atomic Redster 165",
      boardType: "竞速板",
      edgeAngle: "侧刃87° / 底刃0.5°",
      edgeReviewed: false,
      damages: [
        { id: "d-202-1", location: "板尾磕伤", lengthCm: 3, repaired: false },
        { id: "d-202-2", location: "底板中部划痕", lengthCm: 12, repaired: true },
      ],
      slotId: null,
      sealCode: null,
      pickupContact: "",
      pickupDate: "",
      createdAt: "2026-09-19",
      sealedAt: null,
      pickedAt: null,
      history: [
        { at: "2026-09-19", text: "工单开立，进入修补流程" },
        { at: "2026-09-21", text: "损伤「底板中部划痕」修补完成" },
      ],
    },
    {
      id: "ORD-203",
      customer: "林雪",
      board: "Capita DOA 154",
      boardType: "公园板",
      edgeAngle: "侧刃89° / 底刃1°",
      edgeReviewed: true,
      damages: [],
      slotId: 1,
      sealCode: "SEAL-7K2Q",
      pickupContact: "林雪本人 138****2201",
      pickupDate: "2026-09-30",
      createdAt: "2026-09-15",
      sealedAt: "2026-09-19",
      pickedAt: null,
      history: [
        { at: "2026-09-15", text: "工单开立，进入修补流程" },
        { at: "2026-09-19", text: "刃角复核通过（侧刃89° / 底刃1°）" },
        {
          at: "2026-09-19",
          text: "封存入位 #1，封存码 SEAL-7K2Q，取板联系人 林雪本人 138****2201，到场日 2026-09-30",
        },
      ],
    },
    {
      id: "ORD-204",
      customer: "王野",
      board: "Jones Flagship 161",
      boardType: "粉雪板",
      edgeAngle: "侧刃88° / 底刃1°",
      edgeReviewed: true,
      damages: [
        { id: "d-204-1", location: "边刃锈点打磨", lengthCm: 5, repaired: true },
      ],
      slotId: 2,
      sealCode: "SEAL-M3X8",
      pickupContact: "王野朋友 阿凯",
      pickupDate: "2026-09-15",
      createdAt: "2026-09-10",
      sealedAt: "2026-09-12",
      pickedAt: null,
      history: [
        { at: "2026-09-10", text: "工单开立，进入修补流程" },
        { at: "2026-09-11", text: "损伤「边刃锈点打磨」修补完成" },
        { at: "2026-09-12", text: "刃角复核通过（侧刃88° / 底刃1°）" },
        {
          at: "2026-09-12",
          text: "封存入位 #2，封存码 SEAL-M3X8，取板联系人 王野朋友 阿凯，到场日 2026-09-15",
        },
      ],
    },
    {
      id: "ORD-205",
      customer: "王野",
      board: "Nitro Team 157",
      boardType: "公园板",
      edgeAngle: "侧刃88° / 底刃1°",
      edgeReviewed: true,
      damages: [],
      slotId: null,
      sealCode: "SEAL-P9D4",
      pickupContact: "王野本人",
      pickupDate: "2026-09-08",
      createdAt: "2026-09-05",
      sealedAt: "2026-09-06",
      pickedAt: "2026-09-08",
      history: [
        { at: "2026-09-05", text: "工单开立，进入修补流程" },
        { at: "2026-09-06", text: "刃角复核通过（侧刃88° / 底刃1°）" },
        {
          at: "2026-09-06",
          text: "封存入位 #3，封存码 SEAL-P9D4，取板联系人 王野本人，到场日 2026-09-08",
        },
        { at: "2026-09-08", text: "封存码核对通过，王野本人 取板离场，封存位 #3 释放" },
      ],
    },
  ];

  slots[0].orderId = "ORD-203";
  slots[1].orderId = "ORD-204";
  return { orders, slots };
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (Array.isArray(parsed.orders) && Array.isArray(parsed.slots)) {
        return parsed;
      }
    }
  } catch {
    // 存储损坏时回退到示例数据
  }
  return seed();
}

export interface Actions {
  seal: (orderId: string, contact: string, pickupDate: string) => Result;
  pickup: (orderId: string, code: string) => Result;
  addDamage: (
    orderId: string,
    location: string,
    lengthCm: number
  ) => Result;
  changeEdge: (orderId: string, angle: string) => Result;
  toggleDamage: (orderId: string, damageId: string) => Result;
  reviewEdge: (orderId: string) => Result;
  addOrder: (draft: NewOrderDraft) => Result;
  reset: () => void;
}

export function useWorkbench() {
  const [state, setState] = useState<State>(load);
  const today = todayString();

  // 数据只存浏览器：每次状态变化即持久化，刷新后保留
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 容量或隐私模式异常时不阻断界面操作
    }
  }, [state]);

  const commit = (result: Result): Result => {
    if (result.ok) setState(result.state);
    return result;
  };

  const actions: Actions = {
    seal: (orderId, contact, pickupDate) =>
      commit(trySeal(state, orderId, contact, pickupDate, today)),
    pickup: (orderId, code) =>
      commit(confirmPickup(state, orderId, code, today)),
    addDamage: (orderId, location, lengthCm) =>
      commit(addDamageRule(state, orderId, location, lengthCm, today)),
    changeEdge: (orderId, angle) =>
      commit(changeEdgeAngle(state, orderId, angle, today)),
    toggleDamage: (orderId, damageId) =>
      commit(toggleDamageRepaired(state, orderId, damageId, today)),
    reviewEdge: (orderId) =>
      commit(setEdgeReviewed(state, orderId, today)),
    addOrder: (draft) => commit(addOrderRule(state, draft, today)),
    reset: () => setState(seed()),
  };

  return { state, today, actions };
}
