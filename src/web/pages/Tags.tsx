import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHead } from "../App";
import { Button, Dialog, Empty, ErrorNote, Input, useConfirm, useToast } from "../components/ui";
import { api, type Tag } from "../lib/api";
import { num, TAG_COLORS } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { t, tn } from "../lib/i18n";

export function TagsPage() {
  const { can, bumpLinks } = useSession();
  const { data, error, reload } = useApi<{ data: Tag[] }>("/tags");
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Tag | null>(null);

  async function setColor(tag: Tag, color: string) {
    await api(`/tags/${encodeURIComponent(tag.name)}`, { method: "PATCH", body: { color } });
    void reload();
  }
  async function remove(tag: Tag) {
    if (
      !(await confirm({
        title: t("Delete the tag “{name}”?", { name: tag.name }),
        body: tn(tag.links, "It is removed from {n} link. The link stays.", "It is removed from {n} links. The links stay."),
        confirm: t("Delete tag"),
        danger: true,
      }))
    )
      return;
    await api(`/tags/${encodeURIComponent(tag.name)}`, { method: "DELETE" });
    toast(t("Tag deleted"));
    bumpLinks();
    void reload();
  }

  return (
    <div className="page">
      <PageHead title={t("Tags")} desc={t("Group links by campaign, channel or project. Add tags while editing a link or in bulk from the link list.")} />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data && !data.data.length && (
          <Empty sign={t("untagged")} title={t("No tags yet.")}>
            {t("Tags appear here as soon as a link has one.")}
          </Empty>
        )}
        {data?.data.map((tag) => (
          <div className="list-row" key={tag.name}>
            <span className="tag" style={{ ["--c" as string]: TAG_COLORS[tag.color], fontSize: 14, color: "var(--ink)" }}>
              {tag.name}
            </span>
            <div className="grow">
              <Link to={`/links?tag=${encodeURIComponent(tag.name)}`} className="sub">
                {num(tag.links)} link{tag.links === 1 ? "" : "s"}
              </Link>
            </div>
            {can("links:write") && (
              <div className="row" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 3 }} role="radiogroup" aria-label={`Color for ${tag.name}`}>
                  {Object.entries(TAG_COLORS).map(([k, v]) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={tag.color === k}
                      aria-label={k}
                      onClick={() => void setColor(tag, k)}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: tag.color === k ? "2px solid var(--ink)" : "2px solid transparent",
                        background: v,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="icon" />} aria-label={t("Rename")} onClick={() => setEditing(tag)} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="icon" />} aria-label={t("Delete")} onClick={() => void remove(tag)} />
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <RenameDialog
          tag={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            bumpLinks();
            void reload();
          }}
        />
      )}
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
    <Dialog
      title={t("Rename tag")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="dark" onClick={() => void save()} disabled={!name.trim()}>
            {t("Rename")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        style={{ paddingTop: 12 }}
      >
        <Input
          label={t("Name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          hint={tn(tag.links, "Renames it on {n} link.", "Renames it on {n} links.")}
        />
      </form>
    </Dialog>
  );
}
