import { useEffect, useState } from "react";
import { SCOPES, type Scope } from "../../shared/permissions";
import { Button, Switch } from "../components/ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useSession } from "../lib/session";
import { AuthLayout } from "./Auth";

interface RequestInfo {
  client: { id: string; name: string; client_uri: string | null; logo_uri: string | null; redirect_host: string };
  requested: Scope[];
  allowed: Scope[];
  domains: { id: string; hostname: string }[];
}

/** OAuth consent: an AI assistant or other app asks to use this Waymark. */
export function Authorize() {
  const { me, state } = useSession();
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<Set<Scope>>(new Set());
  const [restrict, setRestrict] = useState(false);
  const [domainIds, setDomainIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);

  useEffect(() => {
    api<RequestInfo>(`/oauth/request?${new URLSearchParams(params)}`)
      .then((i) => {
        setInfo(i);
        setScopes(new Set(i.requested));
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(approve: boolean) {
    setBusy(approve ? "allow" : "deny");
    try {
      const r = await api<{ redirect_to: string }>("/oauth/authorize", {
        body: { ...params, approve, scopes: [...scopes], domain_ids: restrict ? [...domainIds] : null },
      });
      location.href = r.redirect_to;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <AuthLayout instance={state?.instance_name ?? "Waymark"}>
      <div className="stack" style={{ width: "100%", maxWidth: 440 }}>
        {error ? (
          <>
            <h1>{t("This connection cannot continue.")}</h1>
            <p className="form-error" role="alert">
              {error}
            </p>
            <p className="muted">{t("Start the connection again from the app you came from.")}</p>
          </>
        ) : !info ? (
          <p className="muted">{t("Checking the request…")}</p>
        ) : (
          <>
            <div>
              <h1>{t("Connect {app}?", { app: info.client.name })}</h1>
              <p className="lead" style={{ marginBottom: 0 }}>
                {t("{app} wants to use this Waymark as {email}.", { app: info.client.name, email: me!.user.email })}
              </p>
            </div>
            <div className="stack-sm">
              <div className="label">{t("Allow it to")}</div>
              {info.allowed.map((s) => (
                <label key={s} className="check" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" className="box" checked={scopes.has(s)} onChange={() => setScopes(toggle(scopes, s))} style={{ marginTop: 3 }} />
                  <span>
                    {t(SCOPES[s])}{" "}
                    <code className="faint" style={{ fontSize: 11.5 }}>
                      {s}
                    </code>
                  </span>
                </label>
              ))}
            </div>
            {info.domains.length > 1 && (
              <>
                <Switch
                  checked={restrict}
                  onChange={setRestrict}
                  label={t("Limit to specific domains")}
                  description={t("The key can only see and create links on these domains.")}
                />
                {restrict && (
                  <div className="stack-sm" style={{ paddingLeft: 46 }}>
                    {info.domains.map((d) => (
                      <label key={d.id} className="check">
                        <input type="checkbox" className="box" checked={domainIds.has(d.id)} onChange={() => setDomainIds(toggle(domainIds, d.id))} />
                        <span className="mono">{d.hostname}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="faint" style={{ fontSize: 12.5 }}>
              {t("After you allow it, you return to {host}. You can disconnect the app at any time under AI assistants.", { host: info.client.redirect_host })}
            </p>
            <div className="row">
              <Button
                variant="dark"
                loading={busy === "allow"}
                disabled={!scopes.size || (restrict && !domainIds.size) || !!busy}
                onClick={() => void decide(true)}
                style={{ flex: 1, height: 40 }}
              >
                {t("Allow")}
              </Button>
              <Button loading={busy === "deny"} disabled={!!busy} onClick={() => void decide(false)} style={{ height: 40 }}>
                {t("Deny")}
              </Button>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
