/**
 * fetch-noon-trending.js
 * ------------------------------------------------------------------
 * بيحاول يسحب أكثر المنتجات ترندًا من نون السعودية ويحفظها في
 * data/noon-trending.json بنفس الشكل اللي الموقع بيقرأه.
 *
 * ⚠️ ملاحظة مهمة وصريحة قبل ما تشغّله على السيرفر (اقرأها كاملة):
 * الرابط اللي استخدمناه هنا (noon.com/_svc/catalog/api/v3/search) مش API
 * رسمي موثّق من نون للمطوّرين أو للأفلييت — هو Endpoint داخلي بيستخدمه
 * موقع نون نفسه في المتصفح، ومعرضة لأي حاجة من دول من غير سابق إنذار:
 *   - يتغيّر شكل الرد (JSON schema) من غير تنبيه
 *   - يتقفل أو يتطلب هيدرز/مصادقة إضافية (Cloudflare/Bot protection)
 *   - يرجع نتائج مختلفة حسب الـ IP / الموقع الجغرافي
 * يعني السكريبت ده مش مضمون يشتغل 100% على المدى الطويل، وده سبب
 * تقني حقيقي مش تخويف. البديل الأضمن والمتوافق مع شروط نون فعليًا:
 * تتواصل مع فريق Noon Partners وتسأل لو عندهم Product Feed API رسمي
 * (زي Amazon Product Advertising API) — لو موجود، استبدل دالة
 * fetchNoonTrending() بالكود اللي بيكلّم الـ API الرسمي وسيب الباقي
 * (توليد الرابط + حفظ JSON) زي ما هو.
 *
 * الكود هنا مكتوب بحيث لو فشل السحب، الملف القديم يفضل زي ما هو
 * (مش بيتمسح) عشان الموقع مايقعش أبدًا.
 * ------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const NOON_AFFILIATE_CODE = "I0Rypnf1mm8"; // نفس الكود المستخدم في الموقع
const SOURCE_URL = "https://www.noon.com/_svc/catalog/api/v3/search?q=best";
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "noon-trending.json");
const MAX_PRODUCTS = 12;

// نفس منطق toNoonAffiliateLink الموجود في index.html — لازم يفضلوا متطابقين
function toNoonAffiliateLink(url) {
  if (!url || url.includes("s.noon.com")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return url + sep + "utm_source=" + NOON_AFFILIATE_CODE + "&utm_medium=affiliate";
}

// خريطة تقريبية للأقسام حسب اسم المنتج (احتياطية لو الـ API مرجعش قسم واضح)
function guessCategory(name = "") {
  const n = name.toLowerCase();
  if (/(iphone|galaxy|هاتف|جوال|ايفون|سامسونج)/.test(n)) return "جوالات";
  if (/(airpods|watch|سماعة|ساعة|earbuds)/.test(n)) return "إلكترونيات";
  if (/(fryer|قلاية|مطبخ|منزل)/.test(n)) return "منزل ومطبخ";
  if (/(عطر|perfume)/.test(n)) return "جمال وعطور";
  if (/(عباية|تيشيرت|فستان|dress)/.test(n)) return "موضة";
  return "متنوع";
}

async function fetchNoonTrending() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; YanaDealsBot/1.0)",
    },
  });

  if (!res.ok) {
    throw new Error(`فشل الطلب: HTTP ${res.status}`);
  }

  const data = await res.json();

  // ⚠️ الحقل ده تخميني بناءً على شكل عام لردود Catalog APIs.
  // لازم تتأكد من الشكل الحقيقي للرد (data.hits أو data.products أو غيره)
  // بتشغيل: node scripts/fetch-noon-trending.js --debug
  // وتشوف الرد الخام قبل ما تعتمد على المسار ده في الإنتاج.
  const rawItems = data?.hits || data?.products || data?.results || [];

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("شكل الرد غير متوقع — لم يتم العثور على قائمة منتجات في الاستجابة");
  }

  return rawItems.slice(0, MAX_PRODUCTS).map((item) => {
    const name = item.name || item.title || item.sku_name || "منتج بدون اسم";
    const originalUrl = item.url || item.product_url || item.link || null;
    const image = item.image || item.image_url || (item.images && item.images[0]) || null;
    const price = item.price || (item.price_object && item.price_object.value) || null;

    return {
      name,
      img: image,
      price: price ? `${price} ر.س` : null,
      cat: item.category || guessCategory(name),
      q: name,
      amazonLink: null, // مش من نون؛ سيبه فاضي إلا لو عندك ربط يدوي بمنتج أمازون مطابق
      noon: originalUrl ? toNoonAffiliateLink(originalUrl) : null,
    };
  });
}

async function main() {
  let products;
  try {
    products = await fetchNoonTrending();
  } catch (err) {
    console.error("❌ تعذّر سحب بيانات نون:", err.message);
    console.error("سيتم الاحتفاظ بملف data/noon-trending.json كما هو من غير تعديل.");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(products, null, 2) + "\n", "utf-8");
  console.log(`✅ تم حفظ ${products.length} منتج في ${OUTPUT_PATH}`);
}

main();
