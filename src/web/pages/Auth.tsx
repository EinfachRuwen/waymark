import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input } from "../components/ui";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";

/** Deterministic topographic contour lines for the sign-in artwork. */
function Contours() {
  const paths = useMemo(() => {
    const out: string[] = [];
    const cx = 620;
    const cy = 520;
    for (let k = 1; k <= 16; k++) {
      const r = k * 46;
      let d = "";
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const wob = 1 + 0.14 * Math.sin(a * 3 + k * 0.5) + 0.07 * Math.sin(a * 5 - k * 0.3) + 0.04 * Math.cos(a * 7 + k);
        const x = cx + Math.cos(a) * r * wob * 1.25;
        const y = cy + Math.sin(a) * r * wob * 0.85;
        d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      out.push(d + "Z");
    }
    return out;
  }, []);
  return (
    <svg className="contours" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={i % 4 === 3 ? 2 : 1} />
      ))}
    </svg>
  );
}

function AuthLayout({ instance, children }: { instance: string; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden>
        <Contours />
        <div className="pole" />
        <div className="post">
          <span className="sign">{instance}</span>
          <span className="sign">Short links</span>
          <span className="sign">On your own server</span>
        </div>
        <footer>Waymark is a private link shortener. Only people with an account can create links here.</footer>
      </aside>
      <div className="auth-form">{children}</div>
    </div>
  );
}

export function Login({ instanceName }: { instanceName: string }) {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout instance={instanceName}>
      <form onSubmit={submit} className="stack">
        <div>
          <h1>Sign in</h1>
          <p className="lead">to {instanceName}</p>
        </div>
        <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="dark" loading={busy}>
          Sign in
        </Button>
        <p className="faint" style={{ fontSize: 12.5 }}>
          Forgot your password? An owner or admin can send you a new sign-in link from the Team page.
        </p>
      </form>
    </AuthLayout>
  );
}

export function Setup({ tokenRequired }: { tokenRequired: boolean }) {
  const { refresh } = useSession();
  const [f, setF] = useState({ email: "", name: "", password: "", hostname: location.host, instance_name: "Waymark", token: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/setup", { body: f });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout instance={f.instance_name || "Waymark"}>
      <form onSubmit={submit} className="stack">
        <div>
          <h1>Set up Waymark</h1>
          <p className="lead">Create the owner account. You can invite others afterwards.</p>
        </div>
        {tokenRequired && (
          <Input label="Setup token" hint="The value of the SETUP_TOKEN secret you configured." required value={f.token} onChange={set("token")} autoComplete="off" />
        )}
        <Input label="Your name" value={f.name} onChange={set("name")} autoComplete="name" />
        <Input label="Email" type="email" required value={f.email} onChange={set("email")} autoComplete="username" />
        <Input label="Password" type="password" required minLength={10} value={f.password} onChange={set("password")} hint="At least 10 characters." autoComplete="new-password" />
        <div className="grid-2">
          <Input label="Workspace name" required value={f.instance_name} onChange={set("instance_name")} />
          <Input label="Short domain" required value={f.hostname} onChange={set("hostname")} className="mono" hint="Add more later." />
        </div>
        {!tokenRequired && (
          <p className="faint" style={{ fontSize: 12.5 }}>
            Anyone who opens this page first can claim this Waymark. Set a SETUP_TOKEN secret if the URL is public before you finish.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="dark" loading={busy}>
          Create owner account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function Invite({ token }: { token: string }) {
  const { refresh } = useSession();
  const { navigate } = useRouter();
  const [info, setInfo] = useState<{ email: string; name: string; reset: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ email: string; name: string; reset: boolean }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((i) => {
        setInfo(i);
        setName(i.name);
      })
      .catch((e) => setLoadError(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/invite/${encodeURIComponent(token)}`, { body: { password, name } });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout instance="Waymark">
      {loadError ? (
        <div className="stack" style={{ maxWidth: 380 }}>
          <h1 style={{ fontSize: 26 }}>This link no longer works.</h1>
          <p className="muted">{loadError}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <div>
            <h1>{info?.reset ? "Choose a new password" : "Join the team"}</h1>
            <p className="lead">{info ? `for ${info.email}` : "Checking your link…"}</p>
          </div>
          {!info?.reset && <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          <Input label="Password" type="password" required minLength={10} hint="At least 10 characters." value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="dark" loading={busy} disabled={!info}>
            {info?.reset ? "Save password and sign in" : "Create account"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
