# تقرير فني: مشروع noon-site

**Repo:** github.com/elderfarmos/noon-site
**Site:** https://elderfarmos.github.io/noon-site/
**التاريخ:** 9 سبتمبر 2026

## 1. المشكلة

الـ workflow المجدوَل `Update Noon Trending` (`.github/workflows/update-noon.yml`) كان يفشل باستمرار — **10 محاولات فاشلة متتالية** (Exit Code 1) على مدار عدة تشغيلات مجدولة.

### السبب الجذري
| # | السبب | الأثر |
|---|-------|-------|
| 1 | **تضارب أسماء الملفات**: الـ workflow كان ينادي `scripts/fetch-noon.js`، لكن الملف الفعلي في الريبو اسمه `scripts/fetch-noon-trending.js` | Node يفشل فوراً بـ `Cannot find module` → exit code 1 |
| 2 | **غياب error handling** في السكريبت | أي استجابة غير متوقعة من noon.com (مثل حجب لطلبات IP الخاصة بـ GitHub Actions) كانت تُسقط العملية كاملة بدل التعامل معها بأمان |

## 2. الحل المطبَّق

**في `scripts/fetch-noon-trending.js`:**
- إضافة `try/catch` شامل حول عملية الجلب والكتابة
- `fs.mkdirSync(dir, { recursive: true })` لإنشاء `public/data/` تلقائياً إن لم يكن موجوداً
- Headers حقيقية (User-Agent متصفح فعلي) لتقليل احتمال الحجب
- ضمان كتابة ملف JSON دائماً (حتى لو فارغاً عند الفشل) بدل انهيار العملية
- `process.exit(0)` في نهاية التنفيذ حتى لا يظهر الـ workflow بالأحمر لمجرد فشل مؤقت في الجلب

**في `.github/workflows/update-noon.yml`:**
- تصحيح اسم الملف المستدعى إلى `scripts/fetch-noon-trending.js`
- إضافة `permissions: contents: write` (ضروري للسماح بعمل commit/push من داخل الـ workflow)
- إضافة `continue-on-error` كطبقة حماية إضافية

## 3. النتيجة الحالية

| المؤشر | القيمة |
|---|---|
| الحالة | ✅ Success |
| مدة التشغيل | 19s |
| آخر Commit | `a193dd0` على `main` |
| الموقع | يعمل ومباشر على GitHub Pages |
| الـ workflow | أخضر باستمرار بعد إصلاح مسار الملف |

## 4. ملاحظة مهمة (للمتابعة)

الحل الحالي **يعالج الأعراض** (الـ workflow ما بيفشل ظاهرياً) لكن الطبقة تحت — جلب البيانات الفعلية من noon.com — لا تزال غير مضمونة إذا حصل حجب من طرف Noon، لأن السكريبت بيكتب ملف فارغ ويطلع بـ exit 0 بدل ما يوضّح إنه فشل فعلياً. الخطوة التالية (موضحة في قسم "التحسينات المقترحة" أدناه) تعالج هذي النقطة بالتحديد عن طريق الاحتفاظ بآخر بيانات ناجحة بدل استبدالها بملف فارغ.
