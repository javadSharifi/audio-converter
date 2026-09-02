# حذف سیستم System-Wide Boost — دلایل و جزئیات

تاریخ: ۲۰۲۶-۰۹-۰۲

## تصمیم
کل بخش **System-Wide Boost** (بوست صدای سراسری سیستم) به‌طور کامل حذف شد.  
بوست **per-file** داخل Converter (پردازش آفلاین هر فایل با `FileBoosterInline` / `processing/sound_booster`) **حفظ شد** و بدون تغییر باقی مانده.

## دلایل حذف

### ۱) حالت Normal خراب
- بوست نرمال سیستم (WASAPI روی ویندوز / `pactl` روی لینوکس / AudioUnit روی macOS) به‌صورت ناپایدار عمل می‌کرد.
- روی برخی سیستم‌ها یا اعمال نمی‌شد یا باعث قطع/نویز صدا می‌شد.
- نگهداری cross-platform آن هزینه بالا و تست‌پذیری پایین داشت.

### ۲) حالت Live با تاخیر ۲–۳ ثانیه
- حالت Live روی اندروید با `MediaProjection` + `AudioPlaybackCapture` + `AudioTrack` پیاده شده بود.
- صدای بوست‌شده **۲ تا ۳ ثانیه عقب‌تر از منبع اصلی** پخش می‌شد؛ تجربه کاربری غیرقابل قبول.
- این تاخیر ذاتیِ pipeline کپچر → پردازش → پخش است و بدون بازنویسی معماری صوتی در سطح native قابل رفع نبود.

### نتیجه
هیچ‌کدام از دو حالت System-Wide کیفیت قابل عرضه نداشتند. به‌جای نگه‌داشتن فیچر ناقص، کل بخش حذف شد تا تمرکز روی فیچر سالم per-file باقی بماند.

## چه چیزی حذف شد
- **Frontend:** `BoosterPanel.tsx`, `BottomNavigation.tsx`, `NavigationTabs.tsx`, `src/features/live-booster/` (LiveBoosterPage/Toggle/ConsentExplainerSheet/useLiveBooster), `stores/useLiveBoosterStore.ts`, `shared/boosterTypes.ts: LiveBoosterState`
- **Tauri utils:** توابع `startLiveBoost`/`stopLiveBoost`/`setLiveBoostGain`/`getLiveBoostStatus`/`isLiveBoostSupported` و `listAudioSessions`/`setSessionBoost`/`getBoosterCapability`
- **i18n:** کلیدهای `tabLiveBooster`, `liveBoost*`, `unified*`, `desktop*`
- **Rust:** ماژول `src-tauri/src/booster/` (linux/windows/macos/mod), `commands/booster.rs`, توابع live در `commands/mod.rs`, تایپ `LiveBoostStatus` در `types.rs`, رجیستر specta در `lib.rs`, تایپ‌ها در `src/types/generated.ts`
- **Android:** `LiveSoundBoosterService.kt`, منطق `MediaProjection` و `pendingLiveBoostGain` در `MainActivity.kt`, سرویس و پرمیشن‌های `FOREGROUND_SERVICE*` در `AndroidManifest.xml` و `proguard`, تزریق سرویس در `patch-android-project.sh`

## چه چیزی ماند
- `src/features/file-booster/` — `FileBoosterInline`, `FileBoosterPage`, `hooks/useFileBooster.ts`
- `src-tauri/src/processing/sound_booster/` — `analyze.rs`, `boost.rs`, `pipeline.rs`, `presets.rs`, `preview.rs`
- تنظیمات بوست per-file داخل `ConversionOptions` / `TrimSpec` (`boostEnabled`, `boostPreset`, `boostManualGainPercent`)
- داک‌های `SOUND_BOOSTER_ARCHITECTURE.md` و `SOUND_BOOSTER_AUDIT_AND_FIXES.md` (مربوط به per-file، همچنان معتبر)
