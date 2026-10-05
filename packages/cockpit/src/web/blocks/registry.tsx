/**
 * Closed render registry (REQ-COCKPIT-001).
 *
 * A type that is not here cannot be drawn: the server's schema never lets an
 * unknown type through, and this registry has no dynamic component
 * construction, no dangerouslySetInnerHTML, and no codegen path. Agent-supplied
 * inline data is always badged. The release rail is rendered by the shell, not
 * by any surface.
 */

import { useClientState, human, api } from "../store";

function Badge({ label, tone = "neutral" }: { label: string; tone?: string }) {
  return <span className={`badge tone-${tone}`}>{label}</span>;
}

function Metric({ block }: { block: Record<string, unknown> }) {
  return (
    <div className="block metric">
      <span className="metric-label">{String(block.label)}</span>
      <span className={`metric-value tone-${(block.tone as string) ?? "neutral"}`}>
        {String(block.value)}
        {block.unit ? <em>{String(block.unit)}</em> : null}
      </span>
      {block.of ? <span className="metric-of">of {String(block.of)}</span> : null}
      {block.delta ? <span className="metric-delta">{String(block.delta)}</span> : null}
    </div>
  );
}

function Callout({ block }: { block: Record<string, unknown> }) {
  return (
    <div className={`block callout tone-${String(block.tone)}`}>
      {block.title ? <strong>{String(block.title)}: </strong> : null}
      {String(block.text)}
    </div>
  );
}

function Table({ block }: { block: Record<string, unknown> }) {
  const columns = (block.columns as { field: string; label?: string; kind?: string; unit?: string }[]) ?? [];
  const rows = (block.data as Record<string, unknown>[]) ?? [];
  return (
    <div className="block table">
      {block.title ? <div className="block-title">{String(block.title)}</div> : null}
      {!block.source && rows.length > 0 ? <Badge label="agent-supplied" tone="warning" /> : null}
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.field}>{c.label ?? c.field}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, Number(block.limit ?? 200)).map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.field}>
                  {row[c.field] === undefined ? "—" : String(row[c.field])}
                  {c.unit && row[c.field] !== undefined ? <em>{c.unit}</em> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tree({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as { id?: string; label?: string; status?: string }[]) ?? [];
  return (
    <div className="block tree">
      {!block.source && rows.length > 0 ? <Badge label="agent-supplied" tone="warning" /> : null}
      <ul>
        {rows.map((row, i) => (
          <li key={row.id ?? i} className={`status-${row.status ?? "unknown"}`}>
            {row.label ?? row.id ?? "?"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as { at?: string; text?: string; lane?: string }[]) ?? [];
  return (
    <div className="block timeline">
      {rows.map((row, i) => (
        <div key={i} className="timeline-row">
          <span className="timeline-at">{String(row.at ?? "")}</span>
          <span>{String(row.text ?? "")}</span>
        </div>
      ))}
    </div>
  );
}

function Graph({ block }: { block: Record<string, unknown> }) {
  const nodes = (block.nodes as { id: string; label?: string; tone?: string }[]) ?? [];
  const edges = (block.edges as { from: string; to: string; label?: string }[]) ?? [];
  return (
    <div className="block graph">
      <ul className="graph-nodes">
        {nodes.map((n) => <li key={n.id} className={`tone-${n.tone ?? "neutral"}`}>{n.label ?? n.id}</li>)}
      </ul>
      <ul className="graph-edges">
        {edges.map((e, i) => <li key={i}>{e.from} → {e.to}{e.label ? ` (${e.label})` : ""}</li>)}
      </ul>
    </div>
  );
}

function Chart({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as Record<string, unknown>[]) ?? [];
  const series = (block.series as { y: string; label?: string }[]) ?? [];
  const max = Math.max(1, ...rows.flatMap((row) => series.map((s) => Number(row[s.y] ?? 0))));
  return (
    <div className="block chart">
      {rows.map((row, i) => (
        <div key={i} className="chart-row">
          <span className="chart-x">{String(row[String(block.x)] ?? "")}</span>
          {series.map((s) => (
            <span key={s.y} className="chart-bar" style={{ width: `${(Number(row[s.y] ?? 0) / max) * 70}%` }} title={`${s.label ?? s.y}: ${String(row[s.y])}`}>
              {String(row[s.y])}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Compare({ block }: { block: Record<string, unknown> }) {
  const items = (block.items as { label: string }[]) ?? [];
  const criteria = (block.criteria as { name: string; cells: { text: string; tone?: string }[] }[]) ?? [];
  return (
    <div className="block compare">
      <table>
        <thead><tr><th></th>{items.map((i) => <th key={i.label}>{i.label}</th>)}</tr></thead>
        <tbody>
          {criteria.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              {c.cells.map((cell, i) => <td key={i} className={`tone-${cell.tone ?? "neutral"}`}>{cell.text}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Media({ block }: { block: Record<string, unknown> }) {
  const items = (block.items as { label: string; src: string; alt?: string }[]) ?? [];
  return (
    <div className="block media">
      {items.map((item) => (
        <figure key={item.src}>
          <img src={item.src.startsWith("file:") ? `/api/file?path=${encodeURIComponent(item.src.slice(5))}` : item.src} alt={item.alt ?? item.label} />
          <figcaption>{item.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Document({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as { path?: string; lines?: string[] }[]) ?? [];
  return (
    <div className="block document">
      <pre>{(rows[0]?.lines ?? []).join("\n")}</pre>
    </div>
  );
}

function Entity({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as Record<string, unknown>[]) ?? [];
  return (
    <div className="block entity">
      {block.ref ? <Badge label={String(block.ref)} /> : null}
      <pre>{rows[0] ? JSON.stringify(rows[0], null, 1).slice(0, 2000) : "select a row"}</pre>
    </div>
  );
}

function Preflight({ block }: { block: Record<string, unknown> }) {
  const action = block.action as Record<string, string> | undefined;
  return (
    <div className="block preflight">
      {action ? (
        <>
          <div className={`badge class-${action.class}`}>{String(action.class)}</div>
          <dl>
            <dt>target</dt><dd>{action.target}</dd>
            <dt>current</dt><dd>{action.currentState}</dd>
            <dt>expected</dt><dd>{action.expected}</dd>
            <dt>stop if</dt><dd>{action.stopIf}</dd>
            <dt>action</dt><dd>{action.action}</dd>
            <dt>observation</dt><dd>{action.observation}</dd>
            <dt>recovery</dt><dd>{action.recovery}</dd>
          </dl>
          <button onClick={() => human("human.confirm", { surface: block.id, confirmed: true })}>Confirm</button>
          <button onClick={() => human("human.confirm", { surface: block.id, confirmed: false })}>Decline</button>
        </>
      ) : null}
    </div>
  );
}

function Progress({ block }: { block: Record<string, unknown> }) {
  const rows = (block.data as Record<string, unknown>[]) ?? [];
  return (
    <div className="block progress">
      <span>{String(block.label)}</span>
      <span className="progress-bound">{String(block.source)}</span>
      {rows.map((row, i) => <span key={i} className="progress-row">{JSON.stringify(row).slice(0, 120)}</span>)}
    </div>
  );
}

function Ask({ block }: { block: Record<string, unknown> }) {
  const asks = (block.asks as Record<string, unknown>[]) ?? [];
  const answer = (ask: Record<string, unknown>, outcome: string, value?: unknown) =>
    human("human.answer", { surface: block.id, ask: ask.id, outcome, value });
  return (
    <div className="block ask">
      {asks.map((ask) => (
        <div key={String(ask.id)} className="ask-item">
          <div className="ask-prompt">{String(ask.prompt)}</div>
          {ask.why ? <div className="ask-why">{String(ask.why)}</div> : null}
          {ask.input === "select" ? (
            <div className="ask-options">
              {((ask.options as { value: string; label: string; hint?: string; consequence?: string }[]) ?? []).map((o) => (
                <button key={o.value} onClick={() => answer(ask, "answered", o.value)} title={o.consequence ?? ""}>
                  {o.label}
                </button>
              ))}
            </div>
          ) : ask.input === "confirm" ? (
            <div className="ask-options">
              <button onClick={() => answer(ask, "answered", true)}>Yes</button>
              <button onClick={() => answer(ask, "answered", false)}>No</button>
            </div>
          ) : (
            <form onSubmit={(event) => {
              event.preventDefault();
              const input = (event.currentTarget.elements.namedItem("value") as HTMLInputElement);
              answer(ask, "answered", input.value);
            }}>
              <input name="value" placeholder={String(ask.placeholder ?? "")} />
              <button type="submit">Answer</button>
            </form>
          )}
          <button className="ask-defer" onClick={() => answer(ask, "deferred")}>Not yet</button>
        </div>
      ))}
    </div>
  );
}

function Form({ block }: { block: Record<string, unknown> }) {
  return (
    <div className="block form">
      {block.title ? <div className="block-title">{String(block.title)}</div> : null}
      <Ask block={{ ...block, type: "ask" }} />
    </div>
  );
}

/**
 * Viewport (REQ-COCKPIT-005): the game-dominant block. Declarative, typed
 * modes; the src is derived from the mode and target — never from agent HTML.
 */
function Viewport({ block }: { block: Record<string, unknown> }) {
  const target = String(block.target ?? "127.0.0.1:8080");
  const src =
    block.mode === "godot-web" ? `http://${target}/index.html`
    : block.mode === "scenario-replay" ? `http://${target}/?scenario=${encodeURIComponent(String(block.scenario ?? ""))}`
    : `http://${target}/`;
  return (
    <div className="block viewport">
      <div className="viewport-chrome">
        <Badge label={String(block.mode)} tone="ok" />
        <span className="viewport-target">{String(block.source)}</span>
      </div>
      <iframe src={src} sandbox="allow-scripts allow-same-origin" title={String(block.title ?? block.mode)} />
    </div>
  );
}

const REGISTRY: Record<string, (props: { block: Record<string, unknown> }) => React.ReactElement> = {
  metric: Metric, callout: Callout, table: Table, tree: Tree, timeline: Timeline,
  graph: Graph, chart: Chart, compare: Compare, media: Media, document: Document,
  entity: Entity, preflight: Preflight, progress: Progress, ask: Ask, form: Form,
  viewport: Viewport,
};

export function BlockView({ block }: { block: Record<string, unknown> }) {
  const renderer = REGISTRY[String(block.type)];
  if (!renderer) {
    return <div className="block callout tone-danger">unknown block type: {String(block.type)}</div>;
  }
  return renderer({ block });
}

export { useClientState, api };
