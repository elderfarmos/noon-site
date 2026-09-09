// scripts/fetch-noon-trending.js
//
// يجيب بيانات "الترند" من نون ويحدّث public/data/noon-trending.json
//
// ملاحظة مهمة: نون (noon.com) ما عندها API رسمي عام موجّه للمطورين الخارجيين.
// الخيارات المتاحة عملياً:
//   1) Endpoint داخلي غير موثّق (زي api-external.noon.com) — بيشتغل لكن ممكن
//      يتغيّر أو يتحجب في أي وقت لأنه مش مخصص للاستخدام الخارجي.
//   2) خدمة scraping طرف ثالث (Apify وأمثالها) — أكثر استقراراً لكن مدفوعة.
//   3) صفحة HTML عامة + parsing — الأضعف استقراراً لأنها بتتغيّر مع أي
//      تحديث تصميم لنون.
//
// السكريبت تحت مبني بشكل مرن: غيّر NOON_SOURCE فقط حسب الخيار اللي هتعتمده،
// ودالة extractProducts() هي المكان الوحيد اللي المفروض تعدّله لو غيّرت المصدر.

const fs = require("fs");
const path = require("path");

// ============ الإعدادات ============
const NOON_SOURCE_URL =
  process.env.NOON_SOURCE_URL ||
  "https://www.noon.com/_next/data/uae-en/uae-en.json"; // مثال فقط - عدّله حسب endpoint الفعلي المؤكد عندك

const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "noon-trending.json");
const CACHE_META_PATH = path.join(__dirname, "..", "public", "data", ".fetch-meta.json");

// لا تجيب بيانات جديدة لو آخر جلب ناجح كان أقل من ٦ ساعات (نفس دورة الـ cron)
// يمنع استهلاك requests زيادة لو الـ workflow اتشغّل يدوي أكتر من مرة بالغلط
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Rate limiting: تأخير بين أي طلبات متعددة (لو السكريبت بيجيب أكتر من صفحة/فئة)
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000; // exponential backoff: 5s, 10s, 20s

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en;q=0.9",
};

// ============ أدوات مساعدة ============
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDataDir() {
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`تم إنشاء الفولدر: ${dir}`);
  }
}

function readCacheMeta() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_META_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeCacheMeta(meta) {
  fs.writeFileSync(CACHE_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

function isCacheFresh() {
  const meta = readCacheMeta();
  if (!meta || !meta.lastSuccessAt) return false;
  const age = Date.now() - new Date(meta.lastSuccessAt).getTime();
  return age < CACHE_TTL_MS;
}

async function fetchWithRetry(url, options) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, options);

      // احترام rate limiting لو نون رجّعت 429
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 10;
        console.warn(`429 Too Many Requests - الانتظار ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.error(`محاولة ${attempt}/${MAX_RETRIES} فشلت: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(delay);
    }
  }
  throw lastErr;
}

// المكان الوحيد المفروض تعدّله حسب شكل استجابة المصدر الفعلي عندك
function extractProducts(rawJson) {
  // مثال عام - عدّل المسار حسب بنية الـ response الحقيقية
  const items = rawJson?.pageProps?.trendingProducts || rawJson?.products || [];
  return items.map((p) => ({
    id: p.sku || p.id,
    name: p.name || p.title,
    price: p.price?.value ?? p.price ?? null,
    currency: p.price?.currency ?? "SAR",
    image: p.image || p.imageUrl || null,
    url: p.url || null,
  }));
}

// ============ المنطق الرئيسي ============
async function main() {
  ensureDataDir();

  if (isCacheFresh()) {
    console.log("آخر جلب ناجح كان أقل من 6 ساعات - تخطي الجلب (cache fresh)");
    return;
  }

  console.log(`جاري الجلب من: ${NOON_SOURCE_URL}`);
  await sleep(REQUEST_DELAY_MS); // rate limiting بسيط قبل أول طلب

  let products = null;
  let fetchError = null;

  try {
    const res = await fetchWithRetry(NOON_SOURCE_URL, { headers: HEADERS });
    const rawJson = await res.json();
    products = extractProducts(rawJson);

    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("الاستجابة رجعت من غير منتجات - غالباً بنية الـ response اتغيّرت");
    }
  } catch (err) {
    fetchError = err;
    console.error("فشل جلب بيانات نون:", err.message);
  }

  if (products) {
    // نجاح: اكتب البيانات الجديدة وحدّث الـ cache meta
    const payload = {
      updatedAt: new Date().toISOString(),
      source: NOON_SOURCE_URL,
      count: products.length,
      data: products,
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
    writeCacheMeta({ lastSuccessAt: new Date().toISOString(), lastError: null });
    console.log(`تم الحفظ بنجاح: ${products.length} منتج في ${OUTPUT_PATH}`);
  } else {
    // فشل: لا تمسح آخر بيانات ناجحة - سيبها زي ما هي عشان الموقع يفضل شغال
    // ببيانات قديمة بدل ما يبقى فاضي
    console.warn("تم الإبقاء على آخر بيانات ناجحة (لم يتم استبدالها بملف فارغ)");
    writeCacheMeta({
      lastSuccessAt: readCacheMeta()?.lastSuccessAt || null,
      lastError: { message: fetchError?.message, at: new Date().toISOString() },
    });

    // exit 0 مقصود: عدم توفر بيانات جديدة مؤقتاً مش خطأ يستوجب تحمير الـ workflow،
    // طالما فيه بيانات قديمة صالحة على الموقع. راجع الـ log فوق لمعرفة السبب.
    if (!fs.existsSync(OUTPUT_PATH)) {
      // ما فيه حتى بيانات قديمة - هنا فعلاً الوضع حرج ويستاهل exit 1
      console.error("لا توجد بيانات قديمة كنسخة احتياطية - فشل حقيقي");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
