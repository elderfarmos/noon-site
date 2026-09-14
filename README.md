# Yana Deals (noon-site)

موقع يانا ديلز يعرض عروض وترندات نون السعودية، منشور مباشرة على Cloudflare (مو GitHub Pages).

**Live:** https://yana-deals.elderkoba.workers.dev/

## البنية الحالية (بعد إعادة الترتيب - سبتمبر 2026)

المشروع فيه ثلاث قطع منفصلة تشتغل مع بعض:

```
public/               # واجهة الموقع (index.html + assets) - تُنشر كـ Cloudflare Workers Static Assets
public/data/          # noon-trending.json - بيانات الترند المعروضة على الموقع
wrangler.jsonc        # (بالجذر) إعدادات نشر الموقع نفسه على Cloudflare - name: "yana-deals"

worker/               # Cloudflare Worker منفصل تماماً - name: "yana-deals-noon-fetcher"
worker/src/index.js   # يجيب بيانات الترند من نون مباشرة من شبكة Cloudflare (يتجاوز حظر IP اللي كان يصير مع GitHub Actions)
worker/wrangler.jsonc # إعدادات هذا الـ Worker + Cron Trigger كل 6 ساعات + KV namespace (NOON_KV)
```

**آلية التحديث (كل 6 ساعات):**

1. **Cloudflare Worker** (`worker/src/index.js`) يشتغل بجدولة Cron خاصة فيه (مستقلة عن GitHub)، يجيب بيانات الترند من نون، ويخزّنها في KV.
2. **n8n workflow** باسم "Yana Deals - Noon Trending Sync" (على n8n cloud) يشتغل كل 6 ساعات: ينادي endpoint الـ Worker، يحوّل البيانات، ويعمل commit لملف `public/data/noon-trending.json` بهذا الريبو.
3. أي تغيير على `public/data/noon-trending.json` يظهر مباشرة على الموقع اللايف بعد إعادة نشر Cloudflare للـ assets.

## ملاحظة تاريخية مهمة

قبل هذا الترتيب، كان فيه مسار قديم يعتمد على GitHub Actions (`scripts/fetch-noon-trending.js` + `.github/workflows/update-noon.yml`) يجيب بيانات نون مباشرة من رنرات GitHub، وتم إيقافه لأن نون تحجب IPs الخاصة بـ GitHub Actions فكانت عملية الجلب تفشل باستمرار (راجع `noon-site-report.md` و`public/data/.fetch-meta.json` للتفاصيل التاريخية). ملف الـ workflow القديم (`update-noon.yml`) في طريقه للحذف كخطوة تنظيف منفصلة. الـ Cloudflare Worker حل هذي المشكلة لأنه يشتغل من شبكة Cloudflare نفسها.

ملف `scripts/fetch-noon-trending.js` لسه موجود بالريبو كأرشيف/مرجع تاريخي، لكنه غير مستخدم حالياً في أي pipeline فعّال.

## نشر تعديلات جديدة

```bash
# تحديثات الموقع نفسه (public/)
wrangler deploy

# تحديثات الـ Worker (worker/)
cd worker && wrangler deploy
```

## إعداد KV (مهم قبل أي deploy جديد للـ Worker)

`worker/wrangler.jsonc` لازم يحتوي على id حقيقي لـ KV namespace مربوط بـ `NOON_KV`. تأكدي منه عبر Cloudflare Dashboard → Workers & Pages → KV.
