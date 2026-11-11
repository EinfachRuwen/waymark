/** Small user-agent classifier. Good enough for analytics, no 200 kB regex database. */
export interface UaInfo {
  browser: string;
  os: string;
  device: "desktop" | "mobile" | "tablet" | "bot";
  bot: boolean;
  /** Social / chat link-preview fetchers that read Open Graph tags. */
  preview: boolean;
}

const PREVIEW_BOTS =
  /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|pinterest|redditbot|embedly|iframely|mastodon|bluesky|vkshare|tumblr|google-pagerenderer|xing-contenttabreceiver|signal-desktop|iMessage|applebot/i;
const BOTS =
  /bot\b|bot\/|crawler|spider|crawling|slurp|curl\/|wget\/|python-requests|python-urllib|httpx|go-http-client|okhttp|java\/|libwww|axios\/|node-fetch|undici|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|scanner|fetcher|feedfetcher|validator|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot|bingpreview/i;

export function parseUa(ua: string | null | undefined): UaInfo {
  const s = ua || "";
  const preview = PREVIEW_BOTS.test(s);
  const bot = !s || preview || BOTS.test(s);

  let os = "Other";
  if (/windows nt/i.test(s)) os = "Windows";
  else if (/iphone|ipod/i.test(s)) os = "iOS";
  else if (/ipad/i.test(s)) os = "iPadOS";
  else if (/android/i.test(s)) os = "Android";
  else if (/cros/i.test(s)) os = "ChromeOS";
  else if (/mac os x|macintosh/i.test(s)) os = "macOS";
  else if (/linux/i.test(s)) os = "Linux";

  let browser = "Other";
  if (/edg(e|a|ios)?\//i.test(s)) browser = "Edge";
  else if (/opr\/|opera/i.test(s)) browser = "Opera";
  else if (/samsungbrowser/i.test(s)) browser = "Samsung Internet";
  else if (/firefox|fxios/i.test(s)) browser = "Firefox";
  else if (/chrome|crios|chromium/i.test(s)) browser = "Chrome";
  else if (/safari/i.test(s)) browser = "Safari";

  let device: UaInfo["device"] = "desktop";
  if (bot) device = "bot";
  else if (/ipad|tablet|kindle|silk|android(?!.*mobile)/i.test(s)) device = "tablet";
  else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(s)) device = "mobile";

  return { browser, os, device, bot, preview };
}
