# noon-site

موقع ترندات نون - بيتحدث تلقائياً كل 6 ساعات.

## كيف شغال؟
- GitHub Actions بشتغل كل 6 ساعات (cron: `0 */6 * * *`)
- بشغل `scripts/fetch-noon-trending.js`
- بيجيب البيانات ويحفظها في `public/data/noon-trending.json`
- لو فشل الجلب، بيحتفظ بآخر نسخة ناجحة وما بيمسح الموقع
- caching 6 ساعات يمنع الاستهلاك الزايد

## التشغيل اليدوي
من تبويب Actions > Update Noon Trending > Run workflow

## متغيرات البيئة
`NOON_SOURCE_URL` - رابط مصدر بيانات نون (اختياري)
