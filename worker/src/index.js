// worker/src/index.js
//
// Worker مستقل بجدولة Cron خاصة به (كل 6 ساعات)، يشتغل من شبكة Cloudflare
// نفسها - مش GitHub Actions - عشان يتجاوز حجب IP اللي كان يصير مع نون.
//
// شغلتين:
// 1) scheduled(): يجيب بيانات الترند من نون، يخزنها في KV
// 2) fetch(): يقدّم آخر بيانات مخزّنة كـ API عشان موقع Yana Deals يسحب منها

const KV_KEY = "noon-trending";

const BROWSER_PROFILES = [
  {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AE,en;q=0.9,ar;q=0.8",
  },
  {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AE,en;q=0.9",
  },
];

const SOURCES = [
  { name: "noon-next-data", url: "https://www.noon.com/_next/data/uae-en/uae-en.json", type: "json" },
  { name: "noon-homepage-html", url: "https://www.noon.com/uae-en/", type: "html" },
];

function extractFromJson(rawJson) {
  const items =
    rawJson?.pageProps?.trendingProducts ||
    rawJson?.pageProps?.widgets?.find((w) => w.name === "trending")?.products ||
    rawJson?.products ||
    [];
  return items.map((p) => ({
    id: p.sku || p.id,
    name: p.name || p.title,
    price: p.price?.value ?? p.price ?? null,
    currency: p.price?.currency ?? "AED",
    image: p.image || p.imageUrl || null,
    url: p.url || null,
  }));
}

function extractFromHtml(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("__NEXT_DATA__ not found - page structure changed");
  return extractFromJson(JSON.parse(match[1]));
}

async function fetchTrendingData() {
  for (const source of SOURCES) {
    for (let attempt = 0; attempt < BROWSER_PROFILES.length; attempt++) {
      try {
        const res = await fetch(source.url, { headers: BROWSER_PROFILES[attempt] });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const products =
          source.type === "json" ? extractFromJson(JSON.parse(text)) : extractFromHtml(text);
        if (products.length > 0) {
          return { products, source: source.name };
        }
      } catch (err) {
        console.error(`[${source.name}] attempt ${attempt + 1} failed: ${err.message}`);
      }
    }
  }
  return null;
}

export default {
  // يشتغل تلقائياً حسب الـ cron في wrangler.jsonc
  async scheduled(event, env, ctx) {
    const result = await fetchTrendingData();

    if (!result) {
      console.error("كل المصادر فشلت - نحافظ على آخر بيانات مخزنة في KV");
      return;
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      source: result.source,
      count: result.products.length,
      data: result.products,
    };

    await env.NOON_KV.put(KV_KEY, JSON.stringify(payload));
    console.log(`تم تحديث ${result.products.length} منتج من "${result.source}"`);
  },

  // API endpoint يسحب منه موقع Yana Deals بدل ما يقرأ ملف JSON ثابت
  async fetch(request, env, ctx) {
    // تشغيل يدوي للاختبار: افتح رابط الـ Worker مباشرة + ?refresh=1
    const url = new URL(request.url);
    if (url.searchParams.get("refresh") === "1") {
      const result = await fetchTrendingData();
      if (result) {
        const payload = {
          updatedAt: new Date().toISOString(),
          source: result.source,
          count: result.products.length,
          data: result.products,
        };
        await env.NOON_KV.put(KV_KEY, JSON.stringify(payload));
      }
    }

    const stored = await env.NOON_KV.get(KV_KEY);

    return new Response(stored || JSON.stringify({ data: [], count: 0, updatedAt: null }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
