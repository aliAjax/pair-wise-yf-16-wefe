// 状态层：工单/封存位/筛选的唯一数据源，数据只存浏览器 localStorage，刷新保留
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BoardType,
  Damage,
  EdgeSpec,
  Filters,
  SealResult,
  ShopState,
  WorkOrder,
} from "./types";
import {
  codeMatches,
  damageRepaired,
  edgeRechecked,
  evaluateSeal,
  isOccupying,
  isOverdue,
  occupiedSlots,
  shouldReturnFromSeal,
} from "./rules";

const STORAGE_KEY = "snowboard-seal-station:v1";
const SLOT_TOTAL = 8;

export function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function makeEdge(side: number, base: number, passed: boolean): EdgeSpec {
  return {
    side,
    base,
    recheckPassed: passed,
    recheckAt: passed ? todayStr() : null,
  };
}

function makeDamage(
  position: string,
  note: string,
  repaired: boolean,
): Damage {
  return {
    id: uid("dmg"),
    position,
    note,
    repairedAt: repaired ? todayStr() : null,
  };
}

function log(order: WorkOrder, action: string): WorkOrder {
  return {
    ...order,
    history: [...order.history, { at: new Date().toISOString(), action }],
  };
}

/** 首次进入时的演示数据，覆盖修补/封存/催取/可取板各状态 */
function seed(): ShopState {
  const today = new Date();
  const fmt = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return todayStr(d);
  };

  const o1: WorkOrder = {
    id: "ORD-112",
    brand: "Burton Custom",
    length: 156,
    boardType: "全地域",
    customer: "林一舟",
    contact: "138-0000-1122",
    wax: "低温蜡",
    preference: "中等咬雪",
    damages: [makeDamage("板底中部", "P-Tex 划痕 12cm", false)],
    edge: makeEdge(88, 1, false),
    status: "repair",
    sealCode: null,
    slotId: null,
    pickupContact: null,
    dueDate: null,
    sealedAt: null,
    pickedAt: null,
    sealedDamageCount: 0,
    sealedEdge: null,
    history: [{ at: new Date().toISOString(), action: "工单创建" }],
    createdAt: new Date().toISOString(),
  };

  const o2: WorkOrder = {
    id: "ORD-106",
    brand: "F2 Race",
    length: 165,
    boardType: "竞速板",
    customer: "高岚",
    contact: "139-0000-2233",
    wax: "竞速蜡",
    preference: "强抓雪",
    damages: [makeDamage("板尾", "轻微磨白，已补 P-Tex", true)],
    edge: makeEdge(87, 0.5, true),
    status: "sealed",
    sealCode: null,
    slotId: "A2",
    pickupContact: "高岚本人 139-0000-2233",
    dueDate: fmt(2),
    sealedAt: new Date().toISOString(),
    pickedAt: null,
    sealedDamageCount: 1,
    sealedEdge: null,
    history: [{ at: new Date().toISOString(), action: "工单创建" }],
    createdAt: new Date().toISOString(),
  };
  o2.sealedEdge = { ...o2.edge };
  o2.sealCode = "804271";
  o2.history.push({ at: new Date().toISOString(), action: "封存入位 A2" });

  const o3: WorkOrder = {
    id: "ORD-118",
    brand: "Jones Hovercraft",
    length: 158,
    boardType: "粉雪板",
    customer: "苏野",
    contact: "137-0000-4455",
    wax: "粉雪蜡",
    preference: "弱咬雪",
    damages: [],
    edge: makeEdge(89, 1, true),
    status: "urged",
    sealCode: null,
    slotId: "A5",
    pickupContact: "苏野本人 137-0000-4455",
    dueDate: fmt(-3),
    sealedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    pickedAt: null,
    sealedDamageCount: 0,
    sealedEdge: null,
    history: [{ at: new Date().toISOString(), action: "工单创建" }],
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
  };
  o3.sealedEdge = { ...o3.edge };
  o3.sealCode = "519306";
  o3.history.push(
    { at: o3.sealedAt as string, action: "封存入位 A5" },
    { at: new Date().toISOString(), action: "超过到场日，转催取（保留记录）" },
  );

  return {
    orders: [o1, o2, o3],
    slotTotal: SLOT_TOTAL,
    filters: { status: "all", boardType: "all", keyword: "" },
  };
}

function newSealCode(orders: WorkOrder[]): string {
  const used = orders.map((o) => o.sealCode).filter(Boolean) as string[];
  let code = "";
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (used.includes(code));
  return code;
}

function load(): ShopState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShopState;
      if (Array.isArray(parsed.orders)) return parsed;
    }
  } catch {
    // 存储损坏时回退到演示数据
  }
  return seed();
}

/** 释放封存位（封存后退回时调用），刃角复核作废需重新复核 */
function returnToRepair(order: WorkOrder, action: string): WorkOrder {
  const slot = order.slotId ?? "封存位";
  const next = log(order, `${action}，退回修补并释放${slot}`);
  return {
    ...next,
    status: "repair",
    slotId: null,
    sealedAt: null,
    sealedDamageCount: 0,
    sealedEdge: null,
    edge: { ...next.edge, recheckPassed: false, recheckAt: null },
  };
}

export interface NewOrderInput {
  brand: string;
  length: number;
  boardType: BoardType;
  customer: string;
  contact: string;
  wax: string;
  preference: string;
  damageNote: string;
  side: number;
  base: number;
}

export function useShop() {
  const [state, setState] = useState<ShopState>(load);
  // 始终持有最新状态，使封存/取板等操作能同步完成规则判定并返回结果
  const ref = useRef(state);
  ref.current = state;

  // 持久化：任何状态变化都写回浏览器，刷新后保留
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅影响刷新保留
    }
  }, [state]);

  // 每次打开：超过到场日的封存单自动转催取，保留记录与封存位
  useEffect(() => {
    setState((s) => {
      const today = todayStr();
      let changed = false;
      const orders = s.orders.map((o) => {
        if (isOverdue(o, today)) {
          changed = true;
          return log(
            { ...o, status: "urged" },
            "超过到场日，转催取（保留记录）",
          );
        }
        return o;
      });
      return changed ? { ...s, orders } : s;
    });
  }, []);

  const updateOrder = useCallback(
    (id: string, fn: (o: WorkOrder) => WorkOrder) => {
      setState((s) => ({
        ...s,
        orders: s.orders.map((o) => (o.id === id ? fn(o) : o)),
      }));
    },
    [],
  );

  const addOrder = useCallback((input: NewOrderInput) => {
    const s = ref.current;
    const maxNo = s.orders.reduce((m, o) => {
      const n = Number(o.id.replace(/\D/g, ""));
      return Number.isFinite(n) && n > m ? n : m;
    }, 100);
    const order: WorkOrder = {
      id: `ORD-${maxNo + 1}`,
      brand: input.brand.trim(),
      length: input.length,
      boardType: input.boardType,
      customer: input.customer.trim(),
      contact: input.contact.trim(),
      wax: input.wax.trim(),
      preference: input.preference.trim(),
      damages: input.damageNote.trim()
        ? [makeDamage("底板", input.damageNote.trim(), false)]
        : [],
      edge: makeEdge(input.side, input.base, false),
      status: "repair",
      sealCode: null,
      slotId: null,
      pickupContact: null,
      dueDate: null,
      sealedAt: null,
      pickedAt: null,
      sealedDamageCount: 0,
      sealedEdge: null,
      history: [{ at: new Date().toISOString(), action: "工单创建" }],
      createdAt: new Date().toISOString(),
    };
    setState((cur) => ({ ...cur, orders: [order, ...cur.orders] }));
  }, []);

  const setFilters = useCallback((patch: Partial<Filters>) => {
    setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  }, []);

  /** 修补登记：新增损伤（封存后新增会触发退回规则） */
  const addDamage = useCallback(
    (id: string, position: string, note: string) => {
      updateOrder(id, (o) => {
        const next = log(
          {
            ...o,
            damages: [
              ...o.damages,
              makeDamage(position.trim() || "底板", note.trim(), false),
            ],
          },
          `登记损伤：${position || "底板"} ${note}`,
        );
        return isOccupying(next.status) && shouldReturnFromSeal(next)
          ? returnToRepair(next, "封存后新增损伤")
          : next;
      });
    },
    [updateOrder],
  );

  const repairDamage = useCallback(
    (id: string, damageId: string) => {
      updateOrder(id, (o) =>
        log(
          {
            ...o,
            damages: o.damages.map((d) =>
              d.id === damageId ? { ...d, repairedAt: todayStr() } : d,
            ),
          },
          "损伤修补完成",
        ),
      );
    },
    [updateOrder],
  );

  /** 刃角设置/改动；封存或催取中改动即退回修补并释放封存位 */
  const setEdge = useCallback(
    (id: string, side: number, base: number) => {
      updateOrder(id, (o) => {
        const changed = o.edge.side !== side || o.edge.base !== base;
        if (!changed) return o;
        const edge: EdgeSpec = {
          ...o.edge,
          side,
          base,
          recheckPassed: false,
          recheckAt: null,
        };
        const next = log(
          { ...o, edge },
          `设置刃角：侧刃${side}° / 底刃${base}°`,
        );
        return isOccupying(next.status) && shouldReturnFromSeal(next)
          ? returnToRepair(next, "封存后刃角改动")
          : next;
      });
    },
    [updateOrder],
  );

  const passRecheck = useCallback(
    (id: string) => {
      updateOrder(id, (o) =>
        log(
          {
            ...o,
            edge: { ...o.edge, recheckPassed: true, recheckAt: todayStr() },
          },
          "刃角复核通过",
        ),
      );
    },
    [updateOrder],
  );

  const setPickupInfo = useCallback(
    (id: string, pickupContact: string, dueDate: string) => {
      updateOrder(id, (o) =>
        log(
          { ...o, pickupContact: pickupContact.trim(), dueDate },
          "登记取板联系人与到场日",
        ),
      );
    },
    [updateOrder],
  );

  /**
   * 封存：资格校验 + 封存位/同客户拒绝条件。
   * 失败整单拒绝，原工单与封存位占用不变；成功分配封存位与封存码。
   * 可在同一事务内先落库本次登记的取板联系人与到场日。
   */
  const sealOrder = useCallback(
    (id: string, pickup?: { contact: string; dueDate: string }): SealResult => {
      let s = ref.current;
      let order = s.orders.find((o) => o.id === id);
      if (!order) return { ok: false, error: "工单不存在" };

      // 同事务内先更新取板登记，再据此执行规则校验
      if (
        pickup &&
        (pickup.contact.trim() !== (order.pickupContact ?? "") ||
          pickup.dueDate !== (order.dueDate ?? ""))
      ) {
        order = log(
          { ...order, pickupContact: pickup.contact.trim(), dueDate: pickup.dueDate },
          "登记取板联系人与到场日",
        );
        s = {
          ...s,
          orders: s.orders.map((o) => (o.id === id ? order! : o)),
        };
      }

      const free = s.slotTotal - occupiedSlots(s.orders).size;
      const verdict = evaluateSeal({
        order,
        orders: s.orders,
        freeSlotCount: free,
      });
      if (!verdict.ok) return verdict;

      const occupied = occupiedSlots(s.orders);
      let slot = "";
      for (let i = 1; i <= s.slotTotal; i += 1) {
        const candidate = `A${i}`;
        if (!occupied.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      const code = newSealCode(s.orders);
      const sealed: WorkOrder = log(
        {
          ...order,
          status: "sealed",
          slotId: slot,
          sealCode: code,
          sealedAt: new Date().toISOString(),
          sealedDamageCount: order.damages.length,
          sealedEdge: { ...order.edge },
        },
        `封存入位 ${slot}，封存码 ${code}`,
      );
      setState((cur) => ({
        ...cur,
        orders: cur.orders.map((o) => (o.id === id ? sealed : o)),
      }));
      return { ok: true, code };
    },
    [],
  );

  /** 取板：核对封存码，通过则交付并释放封存位；不通过仅留痕，状态不变 */
  const pickupOrder = useCallback(
    (id: string, code: string): SealResult => {
      const s = ref.current;
      const order = s.orders.find((o) => o.id === id);
      if (!order) return { ok: false, error: "工单不存在" };
      if (!isOccupying(order.status))
        return { ok: false, error: "该工单不在封存状态" };
      if (!codeMatches(order, code)) {
        updateOrder(id, (o) => log(o, "取板核对失败：封存码不一致"));
        return { ok: false, error: "封存码核对不通过，拒绝取板" };
      }
      updateOrder(id, (o) =>
        log(
          {
            ...o,
            status: "picked",
            pickedAt: new Date().toISOString(),
            slotId: null,
            sealCode: null,
          },
          "封存码核对通过，客户取板完成，释放封存位",
        ),
      );
      return { ok: true, code: order.sealCode ?? "" };
    },
    [updateOrder],
  );

  const resetAll = useCallback(() => {
    setState(seed());
  }, []);

  const occupied = useMemo(
    () => occupiedSlots(state.orders),
    [state.orders],
  );

  return {
    state,
    occupied,
    setFilters,
    addOrder,
    addDamage,
    repairDamage,
    setEdge,
    passRecheck,
    setPickupInfo,
    sealOrder,
    pickupOrder,
    resetAll,
    damageRepaired,
    edgeRechecked,
  };
}

export type Shop = ReturnType<typeof useShop>;
