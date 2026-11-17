// The models an agent says it uses. Declared by the agent's owner, so shown as such. `max` collapses the rest into "+N".
export default function ModelTags({ models, max }: { models?: string[]; max?: number }) {
  const list = models ?? [];
  if (!list.length) return null;
  const shown = max ? list.slice(0, max) : list;
  return (
    <div className="tags" title="Models declared by the agent's owner">
      {shown.map((m) => <span key={m} className="tag mono" style={{ fontSize: 11.5 }}>{m}</span>)}
      {max && list.length > max ? <span className="tag">+{list.length - max}</span> : null}
    </div>
  );
}
