import { API_GROUPS } from "../../shared/api-reference";
import { PageHead } from "../App";
import { CopyButton } from "../components/ui";
import { Link } from "../lib/router";

const METHOD_CHIP: Record<string, string> = { GET: "sky", POST: "moss", PATCH: "blaze", DELETE: "ember" };

export function ApiDocs() {
  const base = location.origin;
  const example = `curl -X POST ${base}/api/v1/links \\
  -H "Authorization: Bearer $WAYMARK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/launch","slug":"launch","tags":["campaign"]}'`;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead title="API reference" desc={<>Everything the app does is available over HTTP. Authenticate with an <Link to="/keys">API key</Link> in the Authorization header or as X-API-Key.</>} />
      <div className="stack" style={{ gap: 18 }}>
        <section className="panel">
          <div className="panel-body stack-sm">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="section-title">Quick start</div>
              <CopyButton text={example} />
            </div>
            <pre className="code">{example}</pre>
            <p className="muted" style={{ fontSize: 13 }}>
              Responses are JSON. Errors look like <code>{`{"error":{"code":"slug_taken","message":"…"}}`}</code> with a matching HTTP status. Timestamps are milliseconds since 1970; inputs also accept ISO 8601.
            </p>
          </div>
        </section>
        {API_GROUPS.map((g) => (
          <section className="panel" key={g.title}>
            <div className="panel-head"><h2>{g.title}</h2></div>
            <div className="list-rows" style={{ marginTop: 8 }}>
              {g.endpoints.map((e) => (
                <div key={e.method + e.path} className="list-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <span className={`chip ${METHOD_CHIP[e.method]}`} style={{ width: 62, justifyContent: "center", fontFamily: "var(--mono)" }}>{e.method}</span>
                  <div className="grow" style={{ minWidth: 240 }}>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{e.path}</div>
                    <p className="muted" style={{ fontSize: 13, marginTop: 3, maxWidth: "75ch" }}>{e.summary}</p>
                    {e.body && <pre className="code" style={{ marginTop: 8, fontSize: 12 }}>{e.body}</pre>}
                  </div>
                  {e.scope && <code className="faint" style={{ fontSize: 12 }}>{e.scope}</code>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
