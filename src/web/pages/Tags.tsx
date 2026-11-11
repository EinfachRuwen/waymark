import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHead } from "../App";
import { Button, Dialog, Empty, ErrorNote, Input, useConfirm, useToast } from "../components/ui";
import { api, type Tag } from "../lib/api";
import { num, TAG_COLORS } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";

export function TagsPage() {
  const { can, bumpLinks } = useSession();
  const { data, error, reload } = useApi<{ data: Tag[] }>("/tags");
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Tag | null>(null);

  async function setColor(t: Tag, color: string) {
    await api(`/tags/${encodeURIComponent(t.name)}`, { method: "PATCH", body: { color } });
    void reload();
  }
  async function remove(t: Tag) {
    if (!(await confirm({ title: `Delete the tag “${t.name}”?`, body: `It is removed from ${num(t.links)} links. The links stay.`, confirm: "Delete tag", danger: true }))) return;
    await api(`/tags/${encodeURIComponent(t.name)}`, { method: "DELETE" });
    toast("Tag deleted");
    bumpLinks();
    void reload();
  }

  return (
    <div className="page">
      <PageHead title="Tags" desc="Group links by campaign, channel or project. Add tags while editing a link or in bulk from the link list." />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data && !data.data.length && <Empty sign="untagged" title="No tags yet.">Tags appear here as soon as a link has one.</Empty>}
        {data?.data.map((t) => (
          <div className="list-row" key={t.name}>
            <span className="tag" style={{ ["--c" as string]: TAG_COLORS[t.color], fontSize: 14, color: "var(--ink)" }}>{t.name}</span>
            <div className="grow">
              <Link to={`/links?tag=${encodeURIComponent(t.name)}`} className="sub">{num(t.links)} link{t.links === 1 ? "" : "s"}</Link>
            </div>
            {can("links:write") && (
              <div className="row" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 3 }} role="radiogroup" aria-label={`Color for ${t.name}`}>
                  {Object.entries(TAG_COLORS).map(([k, v]) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={t.color === k}
                      aria-label={k}
                      onClick={() => void setColor(t, k)}
                      style={{ width: 18, height: 18, borderRadius: 4, border: t.color === k ? "2px solid var(--ink)" : "2px solid transparent", background: v, cursor: "pointer", padding: 0 }}
                    />
                  ))}
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="icon" />} aria-label="Rename" onClick={() => setEditing(t)} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="icon" />} aria-label="Delete" onClick={() => void remove(t)} />
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && <RenameDialog tag={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); bumpLinks(); void reload(); }} />}
    </div>
  );
}

function RenameDialog({ tag, onClose, onDone }: { tag: Tag; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await api(`/tags/${encodeURIComponent(tag.name)}`, { method: "PATCH", body: { name } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Rename tag" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => void save()} disabled={!name.trim()}>Rename</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ paddingTop: 12 }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus hint={`Renames it on ${num(tag.links)} links.`} />
      </form>
    </Dialog>
  );
}
