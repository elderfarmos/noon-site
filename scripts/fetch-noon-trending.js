// scripts/fetch-noon.js
// يجيب بيانات Noon Trending ويكتبها في public/data/noon-trending.json
// مصمم عشان يشتغل جوا GitHub Actions من غير ما يفشل السكريبت كله لو صار خطأ مؤقت

const fs = require("fs");
const path = require("path");

// عدّل هذا الرابط حسب مصدر البيانات الفعلي عندك (API نون أو صفحة بتعمل لها scrape)
const NOON_URL = process.env.NOON_SOURCE_URL || "https://www.noon.com/";

const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "noon-trending.json");

// User-Agent حقيقي عشان نقلل احتمال البلوك من نون لطلبات GitHub Actions
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en;q=0.9",
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      console.error(`محاولة ${attempt}/${retries} فشلت: ${err.message}`);
      if (attempt === retries) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function ensureOutputDir() {
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`تم إنشاء الفولدر: ${dir}`);
  }
}

// TODO: عدّل هذي الدالة حسب شكل الـ response الفعلي (JSON API أو HTML)
function parseNoonData(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    // لو الاستجابة HTML مش JSON، رجّع رسالة واضحة بدل ما السكريبت ينهار بصمت
    throw new Error(
      "الاستجابة مش JSON صالح - تأكد إن NOON_SOURCE_URL بيرجع API JSON مباشر مش صفحة HTML"
    );
  }
}

async function main() {
  console.log(`جاري الجلب من: ${NOON_URL}`);

  let data;
  try {
    const res = await fetchWithRetry(NOON_URL, { headers: HEADERS });
    const rawText = await res.text();
    data = parseNoonData(rawText);
  } catch (err) {
    console.error("فشل جلب بيانات نون:", err.message);
    // بدل ما نخلي الـ workflow كله يفشل بـ exit 1 لو فيه بيانات قديمة موجودة،
    // ممكن تختار تسيب آخر بيانات ناجحة زي ما هي بدل ما تكسر الموقع.
    // لو عايز الفشل الصريح يفضل زي ما هو، سيب السطر تحت:
    process.exit(1);
  }

  ensureOutputDir();

  const payload = {
    updatedAt: new Date().toISOString(),
    data,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`تم الحفظ بنجاح في: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
