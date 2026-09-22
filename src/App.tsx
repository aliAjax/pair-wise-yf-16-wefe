import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { useWorkbench, type Actions } from "./store";
import {
  SLOT_COUNT,
  deriveStatus,
  type OrderStatus,
  type Result,
  type WorkOrder,
} from "./rules";

const BOARD_TYPES = ["公园板", "竞速板", "粉雪板"];
const STATUS_TABS: Array<OrderStatus | "全部"> = [
  "全部",
  "修补中",
  "待封存",
  "已封存",
  "催取中",
  "已取板",
];

const STATUS_CLASS: Record<OrderStatus, string> = {
  修补中: "badge repair",
  待封存: "badge ready",
  已封存: "badge sealed",
  催取中: "badge overdue",
  已取板: "badge picked",
};

type Banner = { kind: "ok" | "err"; text: string } | null;

export default function App() {
  const { state, today, actions } = useWorkbench();
  const [boardFilter, setBoardFilter] = useState<string>("全部");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "全部">(
    "全部"
  );
  const [banner, setBanner] = useState<Banner>(null);

  const rows = useMemo(
    () =>
      state.orders.map((order) => ({
        order,
        status: deriveStatus(order, today),
      })),
    [state.orders, today]
  );

  const visibleRows = rows.filter(
    (r) =>
      (boardFilter === "全部" || r.order.boardType === boardFilter) &&
      (statusFilter === "全部" || r.status === statusFilter)
  );

  const count = (s: OrderStatus) =>
    rows.filter((r) => r.status === s).length;
  const usedSlots = state.slots.filter((s) => s.orderId !== null).length;

  const customers = useMemo(() => {
    const map = new Map<
      string,
      { total: number; unpicked: number; picked: number; latest: string }
    >();
    for (const { order } of rows) {
      const c =
        map.get(order.customer) ?? {
          total: 0,
          unpicked: 0,
          picked: 0,
          latest: "",
        };
      c.total += 1;
      if (order.slotId !== null && order.pickedAt === null) c.unpicked += 1;
      if (order.pickedAt !== null) c.picked += 1;
      if (order.createdAt > c.latest) c.latest = order.createdAt;
      map.set(order.customer, c);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "zh-Hans-CN")
    );
  }, [rows]);

  const notify = (r: Result) => {
    setBanner(r.ok ? { kind: "ok", text: r.note } : { kind: "err", text: r.reason });
  };

  return (
    <main className="app">
      <section className="hero">
        <div className="heading">
          <div>
            <p>hxyfront-62004 · Port 62004</p>
            <h1>雪板交付封存台</h1>
          </div>
          <button
            className="ghost"
            onClick={() => {
              actions.reset();
              setBanner({ kind: "ok", text: "已恢复为示例数据" });
            }}
          >
            恢复示例数据
          </button>
        </div>
        <span>
          工单必须损伤修补全部完成且刃角复核通过，登记取板联系人与到场日后才能进入封存位；
          封存位不足或同客户已有未取板工单时整单拒绝、原工单与占用不变。
          封存后新增损伤或改动刃角即退回修补并释放封存位；取板核对封存码，超期自动转催取，记录全程保留。
        </span>
      </section>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          {banner.kind === "ok" ? "✓ " : "✕ "}
          {banner.text}
          <button className="banner-close" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}

      <section className="metrics">
        <article>
          <small>修补中工单</small>
          <strong>{count("修补中")}</strong>
        </article>
        <article>
          <small>待封存工单</small>
          <strong>{count("待封存")}</strong>
        </article>
        <article>
          <small>封存位占用</small>
          <strong>
            {usedSlots}
            <em>/{SLOT_COUNT}</em>
          </strong>
        </article>
        <article>
          <small>催取中工单</small>
          <strong>{count("催取中")}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>筛选</h2>
          <p className="muted">板型</p>
          <div className="chips">
            {["全部", ...BOARD_TYPES].map((t) => (
              <button
                key={t}
                className={boardFilter === t ? "active" : ""}
                onClick={() => setBoardFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="muted">工单状态</p>
          <div className="chips">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                className={statusFilter === t ? "active" : ""}
                onClick={() => setStatusFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="muted">
            当前显示 {visibleRows.length} / {state.orders.length} 张工单，封存位与客户历史随数据实时同步
          </p>
        </aside>

        <section className="panel">
          <div className="heading">
            <div>
              <p>封存位 {usedSlots}/{SLOT_COUNT}</p>
              <h2>封存位实况</h2>
            </div>
            <span className="muted">红色为超期催取</span>
          </div>
          <div className="slots">
            {state.slots.map((slot) => {
              const row = slot.orderId
                ? rows.find((r) => r.order.id === slot.orderId)
                : null;
              const cls = !row
                ? "slot free"
                : row.status === "催取中"
                  ? "slot overdue"
                  : "slot used";
              return (
                <div key={slot.id} className={cls}>
                  <b>封存位 #{slot.id}</b>
                  {row ? (
                    <>
                      <span>{row.order.id}</span>
                      <small>
                        {row.order.customer} · {row.order.board}
                      </small>
                      <small>
                        <span className={STATUS_CLASS[row.status]}>
                          {row.status}
                        </span>
                      </small>
                    </>
                  ) : (
                    <span className="muted">空位</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>工单流程</p>
            <h2>维护工单列表</h2>
          </div>
        </div>
        <div className="orders">
          {visibleRows.length === 0 && (
            <p className="muted">当前筛选条件下没有工单。</p>
          )}
          {visibleRows.map(({ order, status }) => (
            <OrderCard
              key={order.id}
              order={order}
              status={status}
              today={today}
              actions={actions}
              notify={notify}
            />
          ))}
        </div>
      </section>

      <section className="workspace bottom">
        <NewOrderForm actions={actions} notify={notify} />

        <section className="panel">
          <div className="heading">
            <div>
              <p>客户历史维护记录</p>
              <h2>客户历史</h2>
            </div>
          </div>
          <table className="cust-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>工单总数</th>
                <th>封存未取</th>
                <th>已取板</th>
                <th>最近开单</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(([name, c]) => (
                <tr key={name} className={c.unpicked > 0 ? "has-unpicked" : ""}>
                  <td>{name}</td>
                  <td>{c.total}</td>
                  <td>{c.unpicked > 0 ? `${c.unpicked} 张未取` : "—"}</td>
                  <td>{c.picked}</td>
                  <td>{c.latest}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            同一客户存在“封存未取”工单时，该客户其他工单的封存申请会被整单拒绝。
          </p>
        </section>
      </section>
    </main>
  );
}

function OrderCard({
  order,
  status,
  today,
  actions,
  notify,
}: {
  order: WorkOrder;
  status: OrderStatus;
  today: string;
  actions: Actions;
  notify: (r: Result) => void;
}) {
  const archived = status === "已取板";
  const sealed = order.slotId !== null;

  const [edge, setEdge] = useState(order.edgeAngle);
  const [contact, setContact] = useState(order.pickupContact);
  const [date, setDate] = useState(order.pickupDate);
  const [code, setCode] = useState("");
  const [dmgLoc, setDmgLoc] = useState("");
  const [dmgLen, setDmgLen] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => setEdge(order.edgeAngle), [order.edgeAngle]);
  useEffect(() => setContact(order.pickupContact), [order.pickupContact]);
  useEffect(() => setDate(order.pickupDate), [order.pickupDate]);

  return (
    <article className="order-card">
      <header>
        <div>
          <h3>
            {order.id} · {order.board}
            <span className={STATUS_CLASS[status]}>{status}</span>
          </h3>
          <p className="muted">
            客户 {order.customer} · {order.boardType} · 刃角 {order.edgeAngle}{" "}
            {order.edgeReviewed ? "（已复核）" : "（未复核）"} · 开单{" "}
            {order.createdAt}
          </p>
        </div>
        {sealed && (
          <div className="slot-tag">
            封存位 #{order.slotId}
            <small>{order.sealedAt} 封存</small>
          </div>
        )}
      </header>

      {/* 底板损伤 */}
      <div className="block">
        <p className="block-title">底板损伤与修补</p>
        <div className="damage-list">
          {order.damages.length === 0 && (
            <p className="muted">暂无损伤记录</p>
          )}
          {order.damages.map((d) => (
            <div className="damage-row" key={d.id}>
              <span className={`dot ${d.repaired ? "fixed" : "open"}`} />
              <span>
                {d.location} · {d.lengthCm}cm
              </span>
              <span className={`dmg-state ${d.repaired ? "fixed-text" : "open-text"}`}>
                {d.repaired ? "已修补" : "待修补"}
              </span>
              {!archived && (
                <button
                  onClick={() =>
                    notify(actions.toggleDamage(order.id, d.id))
                  }
                >
                  {d.repaired ? "标回未修" : "标记修补完成"}
                </button>
              )}
            </div>
          ))}
        </div>
        {!archived && (
          <div className="inline-form">
            <input
              placeholder="损伤位置"
              value={dmgLoc}
              onChange={(e) => setDmgLoc(e.target.value)}
            />
            <input
              className="len-input"
              placeholder="长度 cm"
              type="number"
              min="1"
              value={dmgLen}
              onChange={(e) => setDmgLen(e.target.value)}
            />
            <button
              onClick={() => {
                const r = actions.addDamage(
                  order.id,
                  dmgLoc,
                  parseFloat(dmgLen)
                );
                if (r.ok) {
                  setDmgLoc("");
                  setDmgLen("");
                }
                notify(r);
              }}
            >
              登记损伤{sealed ? "（将退回修补）" : ""}
            </button>
          </div>
        )}
      </div>

      {/* 刃角 */}
      <div className="block">
        <p className="block-title">刃角参数与复核</p>
        <div className="inline-form">
          <input
            value={edge}
            disabled={archived}
            onChange={(e) => setEdge(e.target.value)}
          />
          {!archived && (
            <>
              <button
                onClick={() => notify(actions.changeEdge(order.id, edge))}
              >
                改动刃角{sealed ? "（将退回修补）" : ""}
              </button>
              <button
                className={order.edgeReviewed ? "done" : ""}
                disabled={order.edgeReviewed}
                onClick={() => notify(actions.reviewEdge(order.id))}
              >
                {order.edgeReviewed ? "刃角已复核通过" : "刃角复核通过"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 封存 / 取板 */}
      {status === "待封存" && (
        <div className="seal-box">
          <p className="block-title">
            ✓ 损伤修补全部完成且刃角复核通过，登记取板信息后可进入封存位
          </p>
          <div className="inline-form">
            <input
              placeholder="取板联系人（姓名/电话）"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => notify(actions.seal(order.id, contact, date))}
            >
              进入封存位
            </button>
          </div>
        </div>
      )}

      {(status === "已封存" || status === "催取中") && (
        <div className="seal-box">
          {status === "催取中" ? (
            <p className="block-title open-text">
              到场日 {order.pickupDate} 已过，已转催取；记录与封存位保留
            </p>
          ) : (
            <p className="block-title">
              等待取板 · 到场日 {order.pickupDate}
            </p>
          )}
          <p className="muted">
            封存码 <code>{order.sealCode}</code> · 取板联系人{" "}
            {order.pickupContact}
          </p>
          <div className="inline-form">
            <input
              placeholder="客户到场，输入封存码核对"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => {
                const r = actions.pickup(order.id, code);
                if (r.ok) setCode("");
                notify(r);
              }}
            >
              核对封存码并取板
            </button>
          </div>
        </div>
      )}

      {archived && (
        <p className="muted">
          已于 {order.pickedAt} 凭封存码 {order.sealCode} 取板归档，记录保留可查。
        </p>
      )}

      <footer>
        <button className="ghost" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "收起操作记录" : `查看操作记录（${order.history.length}）`}
        </button>
        {showHistory && (
          <ul className="hist">
            {order.history
              .slice()
              .reverse()
              .map((e, i) => (
                <li key={i}>
                  <time>{e.at}</time>
                  {e.text}
                </li>
              ))}
          </ul>
        )}
      </footer>
    </article>
  );
}

function NewOrderForm({
  actions,
  notify,
}: {
  actions: Actions;
  notify: (r: Result) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [board, setBoard] = useState("");
  const [boardType, setBoardType] = useState(BOARD_TYPES[0]);
  const [edgeAngle, setEdgeAngle] = useState("侧刃88° / 底刃1°");

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>开立工单</p>
          <h2>新维护工单</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>客户姓名</span>
          <input
            placeholder="如：林雪"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </label>
        <label>
          <span>雪板（品牌 / 长度）</span>
          <input
            placeholder="如：Burton Custom 156"
            value={board}
            onChange={(e) => setBoard(e.target.value)}
          />
        </label>
        <label>
          <span>板型</span>
          <select
            value={boardType}
            onChange={(e) => setBoardType(e.target.value)}
          >
            {BOARD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>刃角</span>
          <input
            value={edgeAngle}
            onChange={(e) => setEdgeAngle(e.target.value)}
          />
        </label>
      </div>
      <button
        className="primary full"
        onClick={() => {
          const r = actions.addOrder({ customer, board, boardType, edgeAngle });
          if (r.ok) {
            setCustomer("");
            setBoard("");
          }
          notify(r);
        }}
      >
        开立工单（进入修补流程）
      </button>
    </section>
  );
}
