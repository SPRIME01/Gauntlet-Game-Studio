/**
 * The cockpit shell: immutable release rail on top, Dockview workspace in the
 * middle, work terminal at the bottom (REQ-COCKPIT-002/004/006/009).
 *
 * The rail is rendered by the shell from projected state and cannot be
 * covered, removed, or edited by any agent surface. Workbench mode buttons
 * request mode changes through the server; content updates land in place.
 */

import { useEffect } from "react";
import { DockviewReact, type DockviewReadyEvent, type DockviewApi, type DockviewPanelProps } from "dockview-react";
import { connect, useClientState, human, api, refreshSnapshot, type ClientState } from "./store";
import { BlockView } from "./blocks/registry";

function Rail({ state }: { state: ClientState }) {
  return (
    <header className="rail" id="release-rail">
      <span className="rail-title">GAUNTLET</span>
      <span className="rail-mode">workbench: {state.screenMode}</span>
      <span className="rail-item">connected: {state.connected ? "yes" : "no"}</span>
      <span className="rail-item">contradictions · unknowns · stale · blockers · next move · release verdict</span>
      <span className="rail-verdict">release verdict: owner-settled</span>
    </header>
  );
}

function ModeSwitch({ state }: { state: ClientState }) {
  const modes = ["orient", "decide", "build", "verify", "release"] as const;
  return (
    <nav className="mode-switch">
      {modes.map((mode) => (
        <button
          key={mode}
          className={state.screenMode === mode ? "active" : ""}
          onClick={() => void api("workbench", { mode })}
        >
          {mode.toUpperCase()}
        </button>
      ))}
    </nav>
  );
}

function SurfaceView(props: DockviewPanelProps<{ surfaceId: string }>) {
  const state = useClientState();
  const surface = state.surfaces.find((s) => s.id === props.params.surfaceId);
  if (!surface) return <div className="surface-empty">closed</div>;
  return (
    <div className="surface" data-intent={surface.intent}>
      <div className="surface-head">
        <strong>{surface.title}</strong>
        <span className="badge agent">composed by the agent · process state is in the rail</span>
        {surface.placedBy === "agent" ? null : <span className="badge owner">owner-placed</span>}
      </div>
      {surface.summary ? <div className="surface-summary">{surface.summary}</div> : null}
      <div className="surface-blocks">
        {surface.blocks.map((block, i) => (
          <BlockView key={i} block={block as Record<string, unknown>} />
        ))}
      </div>
    </div>
  );
}

function WorkTerminal({ state }: { state: ClientState }) {
  const pending = state.work.filter((w) => !["accepted", "cancelled", "failed"].includes(w.status));
  // Owner review goes through the human channel (authority: human). The work
  // terminal is owner UI; agent tokens cannot reach these buttons' path.
  const review = (seq: number, accepted: boolean) => {
    human("human.work-review", { seq, accepted });
    setTimeout(() => void refreshSnapshot(), 150);
  };
  return (
    <footer className="terminal">
      <span className="terminal-label">WORK</span>
      {pending.length === 0 ? (
        <span className="terminal-hint">no work in flight — ask: "what should I improve next?"</span>
      ) : (
        pending.map((request) => (
          <span key={request.seq} className="work-request">
            R{request.seq} [{request.status}] {request.text}
            {request.status === "ready_for_review" ? (
              <>
                <button onClick={() => review(request.seq, true)}>Accept</button>
                <button onClick={() => review(request.seq, false)}>Reject</button>
              </>
            ) : null}
          </span>
        ))
      )}
    </footer>
  );
}

export function App() {
  const state = useClientState();

  useEffect(() => {
    connect();
  }, []);

  let dockview: DockviewApi | null = null;
  const onReady = (event: DockviewReadyEvent) => {
    dockview = event.api;
  };

  // The server's surface list is authoritative; apply it as panels.
  useEffect(() => {
    if (!dockview) return;
    const open = new Set(state.surfaces.map((s) => s.id));
    for (const panel of dockview.panels) {
      if (!open.has(String(panel.params.surfaceId))) dockview.removePanel(panel);
    }
    for (const surface of state.surfaces) {
      if (!dockview.getPanel(surface.id)) {
        dockview.addPanel({ id: surface.id, title: surface.title, component: "surface", params: { surfaceId: surface.id } });
      }
    }
  }, [state.surfaces, dockview]);

  const components = { surface: SurfaceView };

  return (
    <div className="cockpit">
      <Rail state={state} />
      <ModeSwitch state={state} />
      <main className="workspace">
        <DockviewReact components={components} onReady={onReady} />
      </main>
      <WorkTerminal state={state} />
    </div>
  );
}

export default App;
