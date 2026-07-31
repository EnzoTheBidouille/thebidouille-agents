import React from 'react';

// The project's linked Obsidian Kanban board, rendered inline. Presentational — data is fetched
// by ProjectDetail (which also uses it to hide the redundant specs board). Renders nothing when
// no board is linked.
export default function KanbanBoard({ data }) {
  if (!data || !data.enabled) return null; // no board linked → no panel

  return (
    <section className="panel span2">
      <div className="panel-head">
        <h2>Kanban <span className="muted small">· obsidian</span></h2>
        <span className="badge neutral" title={data.boardRel}>{data.total} cards</span>
      </div>
      <div className="board-scroll">
        <div className="kanban-board">
          {data.columns.map(col => (
            <div key={col.name} className={`kanban-col${col.cards.length ? '' : ' empty'}`}>
              <div className="col-head"><span>{col.name}</span><span className="muted">{col.cards.length}</span></div>
              {col.cards.map((card, i) => <KanbanCard key={i} card={card} />)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function KanbanCard({ card }) {
  const prs = card.prs || [];
  const main = prs.find(p => p.state);
  return (
    <div className={`kanban-card${card.done ? ' done' : ''}`}>
      <div className="kc-text">{card.text}</div>
      {(card.tags.length > 0 || prs.length > 0) && (
        <div className="kc-tags">
          {prs.map(pr => {
            const cls = `kc-pr state-${(pr.state || 'unknown').toLowerCase()}${pr.draft ? ' draft' : ''}`;
            const label = `PR #${pr.num}${pr.inferred ? ' ≈' : ''}`; // ≈ = matched by branch, not written on the card
            return pr.url
              ? <a key={pr.num} className={cls} href={pr.url} target="_blank" rel="noreferrer"
                   title={pr.inferred ? 'matched by branch' : ''}>{label}</a>
              : <span key={pr.num} className={`${cls} flat`}>{label}</span>;
          })}
          {card.tags.map(t => <span key={t} className="kc-tag">#{t}</span>)}
        </div>
      )}
      {main && (
        <div className={`kc-status state-${main.state.toLowerCase()}`}>
          {main.draft ? 'draft' : main.state.toLowerCase()}
          {(main.mergedAt || main.createdAt) && ` · ${fmtDate(main.mergedAt || main.createdAt)}`}
        </div>
      )}
    </div>
  );
}
