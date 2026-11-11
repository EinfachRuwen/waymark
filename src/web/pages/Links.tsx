import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Copy,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../App";
import { Button, CopyButton, Dialog, Empty, ErrorNote, Input, Menu, Sign, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { api, type Link as LinkT, type Tag } from "../lib/api";
import { ago, copy, num, splitUrl, TAG_COLORS } from "../lib/format";
import { useApi, useDebounced } from "../lib/hooks";
import { useQueryState, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { LinkEditor } from "./LinkEditor";
import { QrDialog } from "./QrDialog";
import { t, tn } from "../lib/i18n";

const PAGE = 50;

export function Links() {
  const { can, domains, linksVersion, bumpLinks } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useQueryState("q");
  const [status, setStatus] = useQueryState("status", "active");
  const [tag, setTag] = useQueryState("tag");
  const [domain, setDomain] = useQueryState("domain");
  const [sort, setSort] = useQueryState("sort", "created");
  const [order, setOrder] = useQueryState("order", "desc");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState(q);
  const dq = useDebounced(search, 250);
  useEffect(() => {
    if (dq !== q) setQ(dq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const params = new URLSearchParams({ status, sort, order, limit: String(PAGE), offset: String(page * PAGE) });
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  if (domain) params.set("domain", domain);
  const { data, error, loading, reload } = useApi<{ data: LinkT[]; total: number }>(`/links?${params}`, [linksVersion]);
  const tags = useApi<{ data: Tag[] }>("/tags", [linksVersion]);
  const tagColor = useMemo(() => new Map((tags.data?.data ?? []).map((t) => [t.name.toLowerCase(), TAG_COLORS[t.color] ?? TAG_COLORS.moss])), [tags.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<LinkT | null>(null);
  const [creating, setCreating] = useState(false);
  const [qr, setQr] = useState<LinkT | null>(null);
  const [tagDialog, setTagDialog] = useState<"add_tags" | "remove_tags" | null>(null);

  const rows = data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    const ids = [...selected];
    if (
      action === "delete" &&
      !(await confirm({
        title: tn(ids.length, "Delete {n} link?", "Delete {n} links?"),
        body: t("Their click history is deleted too. Visitors will see a not-found page."),
        confirm: t("Delete"),
        danger: true,
      }))
    )
      return;
    try {
      const r = await api<{ affected: number }>("/links/actions", { body: { ids, action, ...extra } });
      toast(tn(r.affected, "{n} link updated", "{n} links updated"));
      setSelected(new Set());
      bumpLinks();
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function one(l: LinkT, action: "archive" | "unarchive" | "delete") {
    if (
      action === "delete" &&
      !(await confirm({
        title: t("Delete {link}?", { link: `${l.domain}/${l.slug}` }),
        body: t("Its click history is deleted too. This cannot be undone."),
        confirm: t("Delete link"),
        danger: true,
      }))
    )
      return;
    try {
      if (action === "delete") await api(`/links/${l.id}`, { method: "DELETE" });
      else await api(`/links/${l.id}`, { method: "PATCH", body: { archived: action === "archive" } });
      toast(action === "delete" ? t("Link deleted") : action === "archive" ? t("Link archived") : t("Link restored"));
      bumpLinks();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const sortBy = (key: string) => {
    if (sort === key) setOrder(order === "desc" ? "asc" : "desc");
    else {
      setSort(key);
      setOrder(key === "slug" ? "asc" : "desc");
    }
    setPage(0);
  };
  const SortIcon = ({ k }: { k: string }) =>
    sort === k ? order === "desc" ? <ArrowDown className="icon" style={{ width: 12 }} /> : <ArrowUp className="icon" style={{ width: 12 }} /> : null;

  const filtered = !!(q || tag || domain || status !== "active");
  const total = data?.total ?? 0;

  return (
    <div className="page">
      <PageHead
        title={t("Links")}
        desc={
          data
            ? status === "archived"
              ? tn(total, "{n} archived link", "{n} archived links")
              : status === "expired"
                ? tn(total, "{n} expired link", "{n} expired links")
                : status === "all" || status === "any"
                  ? tn(total, "{n} link", "{n} links")
                  : status === "protected"
                    ? tn(total, "{n} protected link", "{n} protected links")
                    : tn(total, "{n} active link", "{n} active links")
            : " "
        }
        actions={
          can("links:write") && (
            <Button className="hide-sm" variant="primary" icon={<Plus className="icon" />} onClick={() => setCreating(true)}>
              {t("New link")}
            </Button>
          )
        }
      />

      <div className="panel">
        {selected.size > 0 ? (
          <div className="bulkbar">
            <b style={{ marginRight: 8 }}>{t("{n} selected", { n: selected.size })}</b>
            {can("links:write") && (
              <>
                <Button size="sm" icon={<TagIcon className="icon" />} onClick={() => setTagDialog("add_tags")}>
                  {t("Add tags")}
                </Button>
                <Button size="sm" onClick={() => setTagDialog("remove_tags")}>
                  {t("Remove tags")}
                </Button>
                {status === "archived" ? (
                  <Button size="sm" icon={<ArchiveRestore className="icon" />} onClick={() => bulk("unarchive")}>
                    {t("Restore")}
                  </Button>
                ) : (
                  <Button size="sm" icon={<Archive className="icon" />} onClick={() => bulk("archive")}>
                    {t("Archive")}
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              icon={<Copy className="icon" />}
              onClick={async () => {
                await copy(
                  rows
                    .filter((r) => selected.has(r.id))
                    .map((r) => r.short_url)
                    .join("\n"),
                );
                toast(t("Short links copied"));
              }}
            >
              {t("Copy URLs")}
            </Button>
            {can("links:delete") && (
              <Button size="sm" icon={<Trash2 className="icon" />} onClick={() => bulk("delete")}>
                {t("Delete")}
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={() => setSelected(new Set())}>
              {t("Clear")}
            </Button>
          </div>
        ) : (
          <div className="toolbar">
            <div className="input-with-icon grow">
              <Search className="icon" />
              <input
                id="link-search"
                className="input"
                placeholder={t("Search slug, destination, title, notes")}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                aria-label={t("Search links")}
              />
            </div>
            <select
              className="select"
              style={{ width: "auto" }}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              aria-label={t("Status")}
            >
              <option value="active">{t("Active")}</option>
              <option value="expired">{t("Expired")}</option>
              <option value="protected">{t("Password protected")}</option>
              <option value="archived">{t("Archived")}</option>
              <option value="any">{t("All but archived")}</option>
              <option value="all">{t("All")}</option>
            </select>
            {(tags.data?.data.length ?? 0) > 0 && (
              <select
                className="select"
                style={{ width: "auto", maxWidth: 180 }}
                value={tag}
                onChange={(e) => {
                  setTag(e.target.value);
                  setPage(0);
                }}
                aria-label={t("Tag")}
              >
                <option value="">{t("All tags")}</option>
                {tags.data!.data.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {domains.length > 1 && (
              <select
                className="select"
                style={{ width: "auto", maxWidth: 200 }}
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setPage(0);
                }}
                aria-label={t("Domain")}
              >
                <option value="">{t("All domains")}</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.hostname}>
                    {d.hostname}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="box"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && rows.some((r) => selected.has(r.id));
                    }}
                    onChange={toggleAll}
                    aria-label={t("Select all on this page")}
                  />
                </th>
                <th>
                  <button onClick={() => sortBy("slug")}>
                    {t("Short link")} <SortIcon k="slug" />
                  </button>
                </th>
                <th className="hide-sm">{t("Tags")}</th>
                <th className="right">
                  <button onClick={() => sortBy("clicks")}>
                    {t("Clicks")} <SortIcon k="clicks" />
                  </button>
                </th>
                <th className="right hide-sm">
                  <button onClick={() => sortBy("created")}>
                    {t("Created")} <SortIcon k="created" />
                  </button>
                </th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            {loading && !data ? (
              <SkeletonRows cols={6} />
            ) : (
              <tbody>
                {rows.map((l) => {
                  const d = splitUrl(l.url);
                  return (
                    <tr key={l.id} aria-selected={selected.has(l.id)} className="clickable" onClick={() => navigate(`/links/${l.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="box" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.slug}`} />
                      </td>
                      <td style={{ maxWidth: 0, width: "60%" }}>
                        <div className="stack-sm" style={{ gap: 5 }}>
                          <div className="trail">
                            <Sign host={domains.length > 1 ? l.domain : null} slug={l.slug} muted={l.status !== "active"} />
                            {l.has_password && <Lock className="icon faint" aria-label={t("Password protected")} />}
                            {l.status !== "active" && (
                              <span className={`chip ${l.status === "expired" ? "ember" : l.status === "scheduled" ? "sky" : ""}`}>{t(l.status)}</span>
                            )}
                            {l.rules.length + l.variants.length > 0 && (
                              <span className="chip slate">{tn(l.rules.length + l.variants.length, "{n} route", "{n} routes")}</span>
                            )}
                          </div>
                          <div className="trail" style={{ gap: 6 }}>
                            <ArrowRight className="icon faint" style={{ width: 13 }} />
                            <span className="dest">
                              <b>{d.host}</b>
                              {d.rest}
                            </span>
                          </div>
                          {l.title && (
                            <div className="muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {l.title}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="hide-sm">
                        <div className="tags">
                          {l.tags.map((t) => (
                            <button
                              key={t}
                              className="tag"
                              style={{
                                ["--c" as string]: tagColor.get(t.toLowerCase()),
                                background: "none",
                                border: 0,
                                padding: 0,
                                cursor: "pointer",
                                font: "inherit",
                                fontSize: 12,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setTag(t);
                                setPage(0);
                              }}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="right num">
                        <b style={{ fontWeight: 600 }}>{num(l.clicks)}</b>
                        <div className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {l.last_click_at ? ago(l.last_click_at) : t("no clicks")}
                        </div>
                      </td>
                      <td className="right hide-sm faint num" style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                        {ago(l.created_at)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <span className="hide-sm">{l.short_url && <CopyButton text={l.short_url} iconOnly label={t("Copy short link")} />}</span>
                          <Button
                            className="hide-sm"
                            size="sm"
                            variant="ghost"
                            icon={<QrCode className="icon" />}
                            aria-label={t("QR code")}
                            title={t("QR code")}
                            onClick={() => setQr(l)}
                          />
                          <Menu
                            trigger={(p) => (
                              <Button size="sm" variant="ghost" icon={<MoreHorizontal className="icon" />} aria-label={t("More actions")} {...p} />
                            )}
                          >
                            {(close) => (
                              <>
                                {l.short_url && (
                                  <button
                                    onClick={async () => {
                                      close();
                                      await copy(l.short_url!);
                                      toast(t("Copied to clipboard"));
                                    }}
                                  >
                                    <Copy className="icon" /> {t("Copy short link")}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    close();
                                    setQr(l);
                                  }}
                                >
                                  <QrCode className="icon" /> {t("QR code")}
                                </button>
                                {can("links:write") && (
                                  <button
                                    onClick={() => {
                                      close();
                                      setEditing(l);
                                    }}
                                  >
                                    <Pencil className="icon" /> {t("Edit")}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    close();
                                    window.open(l.url, "_blank", "noopener");
                                  }}
                                >
                                  <ArrowRight className="icon" /> {t("Open destination")}
                                </button>
                                {can("links:write") &&
                                  (l.archived ? (
                                    <button
                                      onClick={() => {
                                        close();
                                        void one(l, "unarchive");
                                      }}
                                    >
                                      <ArchiveRestore className="icon" /> {t("Restore")}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        close();
                                        void one(l, "archive");
                                      }}
                                    >
                                      <Archive className="icon" /> {t("Archive")}
                                    </button>
                                  ))}
                                {can("links:delete") && (
                                  <>
                                    <hr />
                                    <button
                                      className="danger"
                                      onClick={() => {
                                        close();
                                        void one(l, "delete");
                                      }}
                                    >
                                      <Trash2 className="icon" /> {t("Delete")}
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </Menu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        {error && <ErrorNote error={error} retry={reload} />}
        {data &&
          !rows.length &&
          (filtered ? (
            <Empty sign={t("no match")} title={t("No links match these filters.")}>
              <Button
                size="sm"
                onClick={() => {
                  setSearch("");
                  setQ("");
                  setTag("");
                  setDomain("");
                  setStatus("active");
                }}
              >
                {t("Clear filters")}
              </Button>
            </Empty>
          ) : (
            <Empty
              sign={t("first-link")}
              title={t("No links yet.")}
              action={
                can("links:write") && (
                  <Button variant="primary" icon={<Plus className="icon" />} onClick={() => setCreating(true)}>
                    {t("Create your first link")}
                  </Button>
                )
              }
            >
              {t("Short links you create appear here with their clicks. Press")} <kbd>N</kbd>{" "}
              {t("anywhere to make one, or bring links over from Short.io, Bitly or a CSV under Import & export.")}
            </Empty>
          ))}

        {total > PAGE && (
          <div className="pager">
            <span className="num">{t("{a}–{b} of {total}", { a: num(page * PAGE + 1), b: num(Math.min(total, (page + 1) * PAGE)), total: num(total) })}</span>
            <div className="row">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t("Previous")}
              </Button>
              <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>
                {t("Next")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {(creating || editing) && (
        <LinkEditor
          link={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(l) => {
            const wasNew = creating;
            setCreating(false);
            setEditing(null);
            bumpLinks();
            if (wasNew) navigate(`/links/${l.id}`);
          }}
        />
      )}
      {qr && <QrDialog link={qr} onClose={() => setQr(null)} />}
      {tagDialog && (
        <TagBulkDialog
          mode={tagDialog}
          onClose={() => setTagDialog(null)}
          onApply={(t) => {
            setTagDialog(null);
            void bulk(tagDialog, { tags: t });
          }}
        />
      )}
    </div>
  );
}

function TagBulkDialog({ mode, onClose, onApply }: { mode: "add_tags" | "remove_tags"; onClose: () => void; onApply: (tags: string[]) => void }) {
  const [v, setV] = useState("");
  const tags = v
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <Dialog
      title={mode === "add_tags" ? t("Add tags") : t("Remove tags")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="dark" disabled={!tags.length} onClick={() => onApply(tags)}>
            {mode === "add_tags" ? t("Add") : t("Remove")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (tags.length) onApply(tags);
        }}
        style={{ paddingTop: 10 }}
      >
        <Input label={t("Tags")} hint={t("Separate with commas.")} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </form>
    </Dialog>
  );
}
