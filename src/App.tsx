import { useMemo, useState } from "react";
import "./styles.css";
import { BOARD_TYPES, STATUS_LABEL } from "./types";
import type { OrderStatus, WorkOrder } from "./types";
import {
  customerHistory,
  filterOrders,
  isOccupying,
  nextDueDate,
} from "./rules";
import { todayStr, useShop } from "./state";

const STATUS_TABS: Array<OrderStatus | "all"> = [
  "all",
  "repair",
  "sealed",
  "urged",
  "picked",
];
const STATUS_TAB_LABEL: Record<string, string> = {
  all: "全部",
  ...STATUS_LABEL,
};

interface Notice {
  kind: "ok" | "err";
  text: string;
}

export default function App() {
  const shop = useShop();
  const { state, occupied } = shop;
  const [activeCustomer, setActiveCustomer] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const visible = useMemo(
    () => filterOrders(state.orders, state.filters),
    [state.orders, state.filters],
  );
  const history = useMemo(
    () => (activeCustomer ? customerHistory(state.orders, activeCustomer) : []),
    [state.orders, activeCustomer],
  );

  const counts = useMemo(() => {
    const c: Record<OrderStatus, number> = {
      repair: 0,
      sealed: 0,
      urged: 0,
      picked: 0,
    };
    state.orders.forEach((o) => {
      c[o.status] += 1;
    });
    return c;
  }, [state.orders]);

  const flash = (n: Notice) => {
    setNotice(n);
    window.setTimeout(() => setNotice(null), 3600);
  };

  const metrics = [
    { label: "修补中工单", value: counts.repair, tone: "repair" },
    { label: "已封存 / 催取", value: counts.sealed + counts.urged, tone: "sealed" },
    { label: "剩余封存位", value: state.slotTotal - occupied.size, tone: "slot" },
    {
      label: "最近到场日",
      value: nextDueDate(state.orders) ?? "—",
      tone: "due",
    },
  ];

  return (
    <main className="app">
      <header className="hero">
        <p>雪板调校店 · 交付环节</p>
        <h1>雪板交付封存台</h1>
        <span>
          损伤修补完成且刃角复核通过方可封存；封存位不足或同客户已有未取板工单时整单拒绝。
          封存后新增损伤或改动刃角将退回修补并释放封存位，取板需核对封存码，超期自动转催取但保留全部记录。
        </span>
      </header>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label} className={`tone-${m.tone}`}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      {notice && (
        <div className={`notice notice-${notice.kind}`}>{notice.text}</div>
      )}

      <section className="workspace">
        <aside className="panel side">
          <h2>工单筛选</h2>
          <div className="filter-block">
            <p className="filter-title">交付状态</p>
            <div className="chips">
              {STATUS_TABS.map((t) => (
                <button
                  key={t}
                  className={state.filters.status === t ? "chip-on" : ""}
                  onClick={() => shop.setFilters({ status: t })}
                >
                  {STATUS_TAB_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <p className="filter-title">板型</p>
            <div className="chips">
              <button
                className={state.filters.boardType === "all" ? "chip-on" : ""}
                onClick={() => shop.setFilters({ boardType: "all" })}
              >
                全部
              </button>
              {BOARD_TYPES.map((t) => (
                <button
                  key={t}
                  className={state.filters.boardType === t ? "chip-on" : ""}
                  onClick={() => shop.setFilters({ boardType: t })}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="search">
            <span>搜索工单号 / 客户 / 品牌</span>
            <input
              value={state.filters.keyword}
              onChange={(e) => shop.setFilters({ keyword: e.target.value })}
              placeholder="如 ORD-106、高岚、Burton"
            />
          </label>

          <h2 className="slot-heading">封存位看板</h2>
          <div className="slots">
            {Array.from({ length: state.slotTotal }, (_, i) => {
              const id = `A${i + 1}`;
              const holder = state.orders.find((o) => o.slotId === id && isOccupying(o.status));
              return (
                <div
                  key={id}
                  className={`slot ${holder ? "slot-busy" : "slot-free"} ${
                    holder?.status === "urged" ? "slot-urged" : ""
                  }`}
                  title={holder ? `${id} · ${holder.id} · ${holder.customer}` : `${id} 空闲`}
                >
                  <b>{id}</b>
                  <small>{holder ? holder.id : "空闲"}</small>
                </div>
              );
            })}
          </div>
          <p className="slot-tip">
            占用 {occupied.size} / {state.slotTotal}；催取中仍保留封存位
          </p>

          {activeCustomer && (
            <div className="history-pane">
              <div className="history-head">
                <h2>客户历史 · {activeCustomer}</h2>
                <button onClick={() => setActiveCustomer(null)}>关闭</button>
              </div>
              {history.length === 0 && <p className="muted">暂无历史工单</p>}
              {history.map((o) => (
                <div key={o.id} className="history-row">
                  <span className={`dot dot-${o.status}`} />
                  <div>
                    <b>{o.id}</b>
                    <small>
                      {o.brand} {o.length}cm · {STATUS_LABEL[o.status]}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="main-col">
          <NewOrderForm
            onCreate={(input) => {
              shop.addOrder(input);
              flash({ kind: "ok", text: "新工单已创建，进入修补中" });
            }}
          />
          <div className="panel list-panel">
            <div className="heading">
              <div>
                <p>交付作业区</p>
                <h2>工单列表（{visible.length}）</h2>
              </div>
              <button
                className="ghost"
                onClick={() => {
                  if (window.confirm("清空浏览器内全部数据并恢复演示工单？")) {
                    shop.resetAll();
                    setActiveCustomer(null);
                  }
                }}
              >
                重置本机数据
              </button>
            </div>
            {visible.length === 0 && <p className="muted">没有符合筛选条件的工单</p>}
            <div className="cards">
              {visible.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  shop={shop}
                  onSelectCustomer={(name) => setActiveCustomer(name)}
                  onFlash={flash}
                />
              ))}
            </div>
          </div>
        </section>
      </section>

      <footer className="foot">
        数据仅保存在本浏览器（localStorage），不上传服务器，刷新与重开页面均保留。
      </footer>
    </main>
  );
}

/* ---------------- 新增工单 ---------------- */

function NewOrderForm({
  onCreate,
}: {
  onCreate: (input: Parameters<ReturnType<typeof useShop>["addOrder"]>[0]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [length, setLength] = useState(156);
  const [boardType, setBoardType] = useState(BOARD_TYPES[0]);
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [wax, setWax] = useState("");
  const [preference, setPreference] = useState("");
  const [damageNote, setDamageNote] = useState("");
  const [side, setSide] = useState(88);
  const [base, setBase] = useState(1);

  const submit = () => {
    if (!brand.trim() || !customer.trim() || length <= 0) return;
    onCreate({
      brand,
      length,
      boardType,
      customer,
      contact,
      wax,
      preference,
      damageNote,
      side,
      base,
    });
    setBrand("");
    setCustomer("");
    setContact("");
    setWax("");
    setPreference("");
    setDamageNote("");
    setOpen(false);
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>收件登记</p>
          <h2>新增维护工单</h2>
        </div>
        <button className="primary" onClick={() => setOpen((v) => !v)}>
          {open ? "收起" : "新增工单"}
        </button>
      </div>
      {open && (
        <div className="field-grid">
          <label>
            <span>雪板品牌 *</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="如 Burton Custom" />
          </label>
          <label>
            <span>长度 (cm) *</span>
            <input type="number" value={length} min={80} max={220}
              onChange={(e) => setLength(Number(e.target.value))} />
          </label>
          <label>
            <span>板型</span>
            <select value={boardType} onChange={(e) => setBoardType(e.target.value as typeof boardType)}>
              {BOARD_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <span>客户姓名 *</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="用于同客户未取板校验" />
          </label>
          <label>
            <span>客户电话</span>
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <label>
            <span>打蜡类型</span>
            <input value={wax} onChange={(e) => setWax(e.target.value)} placeholder="低温蜡 / 竞速蜡" />
          </label>
          <label>
            <span>初始侧刃角 (°)</span>
            <input type="number" step={0.5} value={side} min={85} max={90}
              onChange={(e) => setSide(Number(e.target.value))} />
          </label>
          <label>
            <span>初始底刃角 (°)</span>
            <input type="number" step={0.5} value={base} min={0} max={3}
              onChange={(e) => setBase(Number(e.target.value))} />
          </label>
          <label className="wide">
            <span>客户偏好</span>
            <input value={preference} onChange={(e) => setPreference(e.target.value)} placeholder="如 弱咬雪、公园道具多" />
          </label>
          <label className="wide">
            <span>底板损伤（可选，建成即未修补）</span>
            <input value={damageNote} onChange={(e) => setDamageNote(e.target.value)} placeholder="如 板底中部划痕 12cm，待补 P-Tex" />
          </label>
          <div className="wide form-actions">
            <button className="primary" onClick={submit} disabled={!brand.trim() || !customer.trim()}>
              创建工单
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- 工单卡片 ---------------- */

function OrderCard({
  order,
  shop,
  onSelectCustomer,
  onFlash,
}: {
  order: WorkOrder;
  shop: ReturnType<typeof useShop>;
  onSelectCustomer: (name: string) => void;
  onFlash: (n: Notice) => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const [damagePos, setDamagePos] = useState("");
  const [damageNote, setDamageNote] = useState("");
  const [side, setSide] = useState(order.edge.side);
  const [base, setBase] = useState(order.edge.base);
  const [contact, setContact] = useState(order.pickupContact ?? "");
  const [due, setDue] = useState(order.dueDate ?? "");
  const [code, setCode] = useState("");

  const dmgOk = shop.damageRepaired(order.damages);
  const edgeOk = shop.edgeRechecked(order.edge);
  const locked = isOccupying(order.status);

  const trySeal = () => {
    const r = shop.sealOrder(order.id, { contact, dueDate: due });
    if (r.ok) onFlash({ kind: "ok", text: `${order.id} 封存成功，封存位看板与筛选已同步，封存码 ${r.code}` });
    else onFlash({ kind: "err", text: `封存被拒绝：${r.error}` });
  };

  const tryPickup = () => {
    const r = shop.pickupOrder(order.id, code);
    if (r.ok) {
      onFlash({ kind: "ok", text: `${order.id} 封存码核对通过，已交付取板` });
      setCode("");
    } else {
      onFlash({ kind: "err", text: r.error ?? "取板失败" });
    }
  };

  const addDamage = () => {
    if (!damageNote.trim()) return;
    shop.addDamage(order.id, damagePos, damageNote);
    onFlash(
      locked
        ? { kind: "err", text: "封存后新增损伤：工单退回修补，封存位已释放" }
        : { kind: "ok", text: "损伤已登记" },
    );
    setDamagePos("");
    setDamageNote("");
  };

  const applyEdge = () => {
    if (side === order.edge.side && base === order.edge.base) return;
    shop.setEdge(order.id, side, base);
    onFlash(
      locked
        ? { kind: "err", text: "封存后刃角改动：工单退回修补，封存位已释放，需重新复核" }
        : { kind: "ok", text: "刃角已更新，原复核作废需重新复核" },
    );
  };

  return (
    <article className={`card card-${order.status}`}>
      <div className="card-head">
        <div>
          <h3>{order.id}</h3>
          <p>
            {order.brand} · {order.length}cm · {order.boardType} ·{" "}
            <button className="link" onClick={() => onSelectCustomer(order.customer)}>
              {order.customer}
            </button>
            {order.contact ? ` · ${order.contact}` : ""}
          </p>
        </div>
        <span className={`badge badge-${order.status}`}>{STATUS_LABEL[order.status]}</span>
      </div>

      {order.wax && <p className="muted small">打蜡：{order.wax}　偏好：{order.preference || "—"}</p>}

      <div className="subgrid">
        {/* 底板损伤 */}
        <div className="sub">
          <h4>底板损伤</h4>
          {order.damages.length === 0 && <p className="muted small">无损伤登记</p>}
          <ul className="damage-list">
            {order.damages.map((d) => (
              <li key={d.id}>
                <span className={d.repairedAt ? "done" : "todo"}>
                  {d.position} · {d.note}
                </span>
                {d.repairedAt ? (
                  <em>已修补 {d.repairedAt}</em>
                ) : (
                  <button onClick={() => shop.repairDamage(order.id, d.id)}>修补完成</button>
                )}
              </li>
            ))}
          </ul>
          <div className="inline-add">
            <input placeholder="位置" value={damagePos} onChange={(e) => setDamagePos(e.target.value)} />
            <input placeholder="损伤描述" value={damageNote} onChange={(e) => setDamageNote(e.target.value)} />
            <button onClick={addDamage} disabled={!damageNote.trim()}>
              {locked ? "登记（将退回）" : "登记损伤"}
            </button>
          </div>
        </div>

        {/* 刃角复核 */}
        <div className="sub">
          <h4>刃角复核</h4>
          <div className="edge-row">
            <label>
              <span>侧刃°</span>
              <input type="number" step={0.5} value={side}
                onChange={(e) => setSide(Number(e.target.value))} />
            </label>
            <label>
              <span>底刃°</span>
              <input type="number" step={0.5} value={base}
                onChange={(e) => setBase(Number(e.target.value))} />
            </label>
            <button onClick={applyEdge}>应用</button>
          </div>
          <p className={`check ${edgeOk ? "check-ok" : "check-no"}`}>
            {edgeOk ? `✓ 复核通过（${order.edge.recheckAt}）` : "✗ 尚未复核通过"}
          </p>
          {!edgeOk && (
            <button className="primary" onClick={() => shop.passRecheck(order.id)}>
              刃角复核通过
            </button>
          )}
          {locked && (
            <p className="muted small">封存中改动刃角会立即退回修补并释放封存位</p>
          )}
        </div>
      </div>

      {/* 封存操作区：仅修补中 */}
      {order.status === "repair" && (
        <div className="seal-box">
          <h4>进入封存位</h4>
          <div className="checklist">
            <span className={dmgOk ? "check-ok" : "check-no"}>
              {dmgOk ? "✓" : "✗"} 损伤修补完成
            </span>
            <span className={edgeOk ? "check-ok" : "check-no"}>
              {edgeOk ? "✓" : "✗"} 刃角复核通过
            </span>
            <span className={contact.trim() && due ? "check-ok" : "check-no"}>
              {contact.trim() && due ? "✓" : "✗"} 取板联系人与到场日已登记
            </span>
          </div>
          <div className="inline-add">
            <input placeholder="取板联系人" value={contact}
              onChange={(e) => setContact(e.target.value)} />
            <label className="due">
              <span>到场日</span>
              <input type="date" value={due} min={todayStr()}
                onChange={(e) => setDue(e.target.value)} />
            </label>
            <button className="primary" onClick={trySeal}>
              封存入位
            </button>
          </div>
          <p className="muted small">
            封存位不足或同客户已有未取板工单时，整单拒绝，原工单与占用不变。
          </p>
        </div>
      )}

      {/* 封存/催取：封存信息与取板 */}
      {locked && (
        <div className="stored-box">
          <div className="stored-meta">
            <span>封存位 <b>{order.slotId}</b></span>
            <span>封存码 <b className="code">{order.sealCode}</b></span>
            <span>取板联系 <b>{order.pickupContact}</b></span>
            <span className={order.status === "urged" ? "overdue" : ""}>
              到场日 <b>{order.dueDate}</b>
              {order.status === "urged" && " · 已超期催取"}
            </span>
          </div>
          <div className="inline-add">
            <input
              placeholder="请客户报封存码（6 位）核对"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="primary" onClick={tryPickup} disabled={code.length !== 6}>
              核对取板
            </button>
          </div>
        </div>
      )}

      {order.status === "picked" && (
        <p className="check-ok">
          ✓ 已于 {order.pickedAt?.slice(0, 10)} 取板交付，封存位已释放，记录完整保留。
        </p>
      )}

      <button className="ghost log-toggle" onClick={() => setShowLog((v) => !v)}>
        {showLog ? "收起流转记录" : `查看流转记录（${order.history.length}）`}
      </button>
      {showLog && (
        <ul className="log">
          {[...order.history].reverse().map((h, i) => (
            <li key={i}>
              <time>{h.at.slice(0, 16).replace("T", " ")}</time>
              <span>{h.action}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
