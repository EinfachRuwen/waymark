import { PageHead } from "../App";
import { AnalyticsView, RangePicker, useRange } from "../components/AnalyticsView";
import { Callout } from "../components/ui";
import { useSession } from "../lib/session";
import { Link } from "../lib/router";
import { t } from "../lib/i18n";

export function Overview() {
  const [range, setRange] = useRange();
  const { me, domains, isAdmin } = useSession();
  const onlyWorkersDev = domains.length > 0 && domains.every((d) => d.hostname.endsWith(".workers.dev") || d.hostname.startsWith("localhost"));
  return (
    <div className="page">
      <PageHead
        title={t(`Good ${greeting()}, {name}.`, { name: me?.user.name?.split(" ")[0] || t("there") })}
        desc={t("Clicks across every link in this workspace. Bots and link previews are left out.")}
        actions={<RangePicker value={range} onChange={setRange} />}
      />
      {onlyWorkersDev && isAdmin && (
        <div style={{ marginBottom: 18 }}>
          <Callout kind="warn">
            {t("You are using a temporary hostname.")} <Link to="/domains">{t("Add your own short domain")}</Link> {t("so links stay yours if you move hosts.")}
          </Callout>
        </div>
      )}
      <AnalyticsView range={range} showTop />
      {!me?.settings.track_clicks && (
        <div style={{ marginTop: 18 }}>
          <Callout>{t("Click tracking is turned off in Settings, so no new clicks are recorded.")}</Callout>
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
