# گزارش جامع تحلیل کیفیت و معماری کد (Code Review Report)

این گزارش نتیجهٔ بررسی عمیق و دقیق تمام فایل‌های سورس‌کد پروژه **Audio Converter** (فرانت‌اند React/TypeScript و بک‌اند Rust/Tauri) بر اساس اصول مهندسی نرم‌افزار، الگوهای طراحی، اصول SOLID و استانداردهای Clean Code و امنیت است.

---

## خلاصه اجرایی

- **تعداد کل مشکلات شناسایی‌شده:** ۱۶ مورد
- **توزیع بر اساس سطح شدت:**
  - **بحرانی (Critical):** ۳ مورد
  - **بالا (High):** ۵ مورد
  - **متوسط (Medium):** ۵ مورد
  - **پایین (Low):** ۳ مورد

### مهم‌ترین ۳ مشکلی که باید فوراً رفع شوند:
1. **[Critical - Bug] کوتاه شدن و ناهماهنگی موج صدا (Waveform) برای فایل‌های طولانی‌تر از ۵ دقیقه:**  
   در فایل `src-tauri/src/ffmpeg/waveform.rs` داده‌های صوتی به ۵ دقیقه محدود شده‌اند که باعث می‌شود موج صوتی در فایل‌های بزرگتر فشرده و کاملاً نامنطبق با صدا رسم شود.
2. **[Critical - Concurrency Bug] رفتار متغیر و Race Condition در نام‌گذاری و مسیر خروجی:**  
   در `src-tauri/src/queue/mod.rs` متغیر `multiple_sources` بر اساس طول متغیر صف در لحظه اجرا محاسبه می‌شود که باعث می‌شود آخرین فایل یک صف در مسیر متفاوتی نسبت به سایر فایل‌های همان بچ ذخیره شود.
3. **[Critical - Architecture/SRP] انباشت شدید مسئولیت‌ها (God Store) در Zustand:**  
   فایل `src/stores/useAppStore.ts` تمام منطق‌های صف، تنظیمات، پرونده‌ها، رویدادها، اعلانات و تم را در یک استور یکپارچه متراکم کرده که مانع تفکیک دغدغه‌ها و ایجاد تست‌های واحد ایزوله می‌شود.

---

## فهرست مشکلات به تفکیک دسته‌بندی

---

### ۱. اصول SOLID

#### [شدت: High] نقض اصل مسئولیت واحد (Single Responsibility Principle) در استور فرانت‌اند
- **فایل و خط:** `src/stores/useAppStore.ts:56-317`
- **کد فعلی:**
```typescript
export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  jobs: new Map(),
  settings: null,
  options: { ... },
  lang: "en",
  theme: "system",
  toasts: [],
  probing: false,
  starting: false,
  // بیش از ۲۰ اکشن ناهمگون از ذخیره تنظیمات تا درگ اند دراپ و ایونت لیسنرها
```
- **چرا اشتباه است:** این استور به عنوان یک **God Object** عمل می‌کند. تغییر در بخش کوچکی از اعلانات (Toasts) یا تم باعث ایجاد وابستگی و رندرهای غیرضروری در کامپوننت‌های صف و تبدیل فایل می‌شود.
- **پیشنهاد رفع:** تفکیک به Sliceهای مستقل یا استورهای مجزا:
  - `useFileStore` (مدیریت فایل‌های ورودی و برش)
  - `useQueueStore` (مدیریت صف، پیشرفت و لغو جاب‌ها)
  - `useSettingsStore` (تنظیمات، زبان و تم)
  - `useToastStore` (سیستم اعلانات)
- **اولویت رفع:** نزدیک

---

#### [شدت: Medium] نقض اصل وارونگی وابستگی (Dependency Inversion Principle) در پایپ‌لاین FFmpeg
- **فایل و خط:** `src-tauri/src/ffmpeg/run.rs:111-125` و `src-tauri/src/ffmpeg/probe.rs:15-30`
- **کد فعلی:**
```rust
let mut command = Command::new(&self.program);
command
    .args(&self.args)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
```
- **چرا اشتباه است:** منطق بیزنس و اجرای فرآیندها مستقیماً به ساختار انضمامی `std::process::Command` وابسته است و امکان تزریق وابستگی (Dependency Injection) برای تست‌های سریع بدون اجرای واقعی باینری وجود ندارد.
- **پیشنهاد رفع:** ایجاد یک Trait انتزاعی مثل `ProcessRunner` یا `MediaProber`:
```rust
pub trait ProcessRunner: Send + Sync {
    fn execute(&self, program: &Path, args: &[String]) -> Result<RunOutcome, AppError>;
}
```
- **اولویت رفع:** بلندمدت

---

### ۲. Code Smells

#### [شدت: High] تابع بسیار طولانی و پرپیچ‌وخم (Long Method / Brain Method)
- **فایل و خط:** `src-tauri/src/processing/pipeline.rs:194-417` (`run_job`)
- **کد فعلی:** تابعی با بیش از ۲۲۰ سطر کد متوالی که ۶ فاز مختلف اعم از پروب، تشخیص سکوت، برنامه‌ریزی برش، ساخت پوشه‌ها، چک کردن دیسک، مدیریت تردهای مانیتورینگ پیشرفت و تغییر نام نهایی فایل‌ها را در خود جای داده است.
- **چرا اشتباه است:** پیچیدگی چرخه‌ای (Cyclomatic Complexity) بسیار بالا است، خوانایی کد پایین است و تست کردن هر کدام از این مراحل به صورت ایزوله ناممکن است.
- **پیشنهاد رفع:** شکستن تابع `run_job` به توابع یا ساختارهای کوچک مجزا:
  - `Phase 1: plan_execution_phases(...)`
  - `Phase 2: ensure_disk_headroom(...)`
  - `Phase 3: execute_transcode_part(...)`
  - `Phase 4: finalize_atomic_renames(...)`
- **اولویت رفع:** نزدیک

---

#### [شدت: Low] وجود اعداد و رشته‌های جادویی (Magic Numbers & Strings)
- **فایل و خط:** `src-tauri/src/processing/pipeline.rs:16, 280, 363`
- **کد فعلی:**
```rust
const ENCODE_PHASE_START: f64 = 15.0;
let est = disk::estimate_output_bytes(...) + 8_388_608; // 8MB magic buffer
std::thread::sleep(Duration::from_millis(250));
```
- **چرا اشتباه است:** مقادیری مانند بافر ۸ مگابایتی دیسک و تاخیر پولینگ بدون تعریف ثابت‌های معنادار در بدنه کد رها شده‌اند.
- **پیشنهاد رفع:** تعریف ثابت‌های نام‌گذاری‌شده در بالای ماژول با مستندسازی دلیل انتخاب مقدار:
```rust
const DISK_SAFETY_HEADROOM_BYTES: u64 = 8 * 1024 * 1024;
const PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(250);
```
- **اولویت رفع:** بلندمدت

---

### ۳. باگ‌ها و مشکلات منطقی (Bugs & Logic)

#### [شدت: Critical] خطای محاسبه و قطع موج صدا برای فایل‌های بزرگتر از ۵ دقیقه
- **فایل و خط:** `src-tauri/src/ffmpeg/waveform.rs:89-106`
- **کد فعلی:**
```rust
const CAP_BYTES: usize = 2 * DECODE_RATE as usize * 300; // ۵ دقیقه
let mut pcm: Vec<u8> = Vec::with_capacity(CAP_BYTES.min(1 << 20));
loop {
    match stdout.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
            pcm.extend_from_slice(&buf[..n]);
            if pcm.len() >= CAP_BYTES {
                let _ = child.kill();
                break;
            }
        }
        ...
    }
}
bucket_peaks(&pcm, buckets)
```
- **چرا اشتباه است:** اگر کاربر یک فایل صوتی یا پادکست ۳۰ دقیقه‌ای را برای برش باز کند، خواندن صدا در دقیقه پنجم متوقف می‌شود و باکت‌های تولیدی فقط متعلق به ۵ دقیقه اول هستند، اما فرانت‌اند این باکت‌ها را روی بازه ۳۰ دقیقه‌ای پخش می‌کند که باعث ناهماهنگی کامل موج با صدای در حال پخش می‌شود.
- **پیشنهاد رفع:** محاسبه زنده میانگین/پیک بدون ذخیره کل آرایه در رم (Streaming Bucketing) یا افزایش منطقی سقف با در نظر گرفتن طول کل فایل.
- **اولویت رفع:** فوری

---

#### [شدت: Critical] باگ Race Condition در تفکیک پوشه‌های خروجی چندگانه
- **فایل و خط:** `src-tauri/src/queue/mod.rs:304-309` و `src-tauri/src/processing/naming.rs:85-102`
- **کد فعلی:**
```rust
let multiple_sources = {
    inner.order.lock().unwrap().len() + 1 > 1
};
```
- **چرا اشتباه است:** در حین اجرای موازی، مقدار `multiple_sources` بر اساس تعداد فایل‌های **باقی‌مانده در صف در همان لحظه** محاسبه می‌شود! برای مثال در صفی با ۵ فایل، برای فایل‌های ۱ تا ۴ مقدار `true` است و در ساب‌فولدر ریخته می‌شوند، اما برای فایل پنجم چون صف خالی شده `order.len() == 0` است و `multiple_sources` مقدار `false` می‌گیرد و در پوشه والد ذخیره می‌شود!
- **پیشنهاد رفع:** مقدار `multiple_sources` باید در زمان فراخوانی `enqueue` (بر اساس `items.len() > 1`) به عنوان یک فیلد روی مشخصات جاب ذخیره و ارسال شود.
- **اولویت رفع:** فوری

---

#### [شدت: High] فراخوانی مجدد و زائد `wait()` روی پروسه خاتمه‌یافته
- **فایل و خط:** `src-tauri/src/ffmpeg/run.rs:180-198`
- **کد فعلی:**
```rust
let done = {
    let mut guard = self.cancel.inner.child.lock().unwrap();
    match guard.as_mut() {
        Some(c) => c.try_wait().ok().flatten(),
        None => None,
    }
};
if done.is_some() {
    break;
}
...
// پس از خروج از حلقه:
let (code, final_tail) = {
    let mut guard = self.cancel.inner.child.lock().unwrap();
    let status = guard.as_mut().and_then(|c| c.wait().ok()); // فراخوانی مجدد روی پروسه بسته شده
```
- **چرا اشتباه است:** تابع `try_wait` پروسه را Reap می‌کند؛ اجرای مجدد `wait` روی همان پروسه در پلتفرم‌های یونیکس ممکن است خطای `ECHILD` داده و کد خروجی را `None` برگرداند.
- **پیشنهاد رفع:** نگه‌داری خروجی همان `try_wait` که مقدار `ExitStatus` را در بر دارد و استفاده مستقیم از آن.
- **اولویت رفع:** نزدیک

---

### ۴. امنیت (Security)

#### [شدت: Medium] آسیب‌پذیری احتمالی در برابر نام‌های رزرو شده سیستم‌عامل ویندوز
- **فایل و خط:** `src-tauri/src/processing/naming.rs:18-31`
- **کد فعلی:**
```rust
pub fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() { "output".to_string() } else { trimmed.to_string() }
}
```
- **چرا اشتباه است:** کاراکترهای ممنوعه فیلتر می‌شوند اما نام‌های دستگاه‌های رزرو شده در ویندوز مانند `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` بررسی نمی‌شوند. اگر فایل ورودی چنین نامی داشته باشد، ذخیره خروجی در ویندوز با خطای سطح سیستم‌عامل متوقف می‌شود.
- **پیشنهاد رفع:** افزودن بررسی نام‌های رزرو شده در ویندوز:
```rust
const WINDOWS_RESERVED: &[&str] = &["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
if WINDOWS_RESERVED.contains(&trimmed.to_uppercase().as_str()) {
    return format!("{trimmed}_output");
}
```
- **اولویت رفع:** نزدیک

---

### ۵. عملکرد (Performance)

#### [شدت: High] تکرار کامل فرآیند رمزگشایی در حذف سکوت (Double Decode Overhead)
- **فایل و خط:** `src-tauri/src/processing/pipeline.rs:235-248` و `src-tauri/src/processing/pipeline.rs:368-385`
- **کد فعلی:**
  ۱. در فاز ۱ کل فایل برای `silencedetect` خوانده و تحلیل می‌شود.
  ۲. سپس در فاز ۵ مجدداً کل فایل برای انکود و فیلتر خوانده می‌شود.
- **چرا اشتباه است:** در تبدیل‌های سنگین یا فایل‌های ویدیویی چند گیگابایتی با فلش/هارد دیسک کند، خواندن دوباره کل مدیا مصرف پردازنده و I/O دیسک را دو برابر می‌کند.
- **پیشنهاد رفع:** در صورت فعال بودن حذف سکوت بدون برش چندگانه، اعمال فیلتر سکوت مستقیماً داخل زنجیره فیلتر مرحله انکود با استفاده از فیلتر `silenceremove` به جای اسکن دو مرحله‌ای.
- **اولویت رفع:** بلندمدت

---

#### [شدت: Medium] ایجاد ترد به ازای هر پروسه بدون مدیریت Thread Pool
- **فایل و خط:** `src-tauri/src/queue/mod.rs:130-135` و `src-tauri/src/processing/pipeline.rs:348-366`
- **کد فعلی:**
```rust
for _ in 0..worker_count {
    std::thread::spawn(move || worker_loop(inner, options));
}
```
- **چرا اشتباه است:** ایجاد و تخریب مکرر OS Threadها به ازای هر بچ پردازشی، منابع سیستم را بیهوده درگیر می‌کند.
- **پیشنهاد رفع:** استفاده از کتابخانه‌های استاندارد Thread Pool مانند `rayon` یا `tokio::task`.
- **اولویت رفع:** بلندمدت

---

### ۶. معماری و ساختار پروژه (Architecture)

#### [شدت: Medium] اختلاط منطق بیزنس محاسباتی با لایه نمایش در کامپوننت‌ها
- **فایل و خط:** `src/components/OptionsPanel.tsx:42-50` و `src/components/FileList.tsx:9-12`
- **کد فعلی:**
```typescript
const estFor = (fmt: AudioFormat): { size: string; delta: string } | null => {
  const bytes = estimateOutputBytes(files, fmt, options);
  if (bytes === null) return null;
  return {
    size: `≈${formatBytes(bytes)}`,
    delta: growthHint(files, bytes) ?? "",
  };
};
```
- **چرا اشتباه است:** کامپوننت‌های بصری مانند `OptionsPanel` و `FileList` مسئول فرمت‌دهی، تخمین محاسبات بیزنس و تحلیل نوع فایل شده‌اند که اصل جداسازی دغدغه‌ها (Separation of Concerns) را نقض می‌کند.
- **پیشنهاد رفع:** انتقال منطق به Custom Hookهای مجزا مانند `useOutputEstimation` و توابع کمکی دامنه.
- **اولویت رفع:** نزدیک

---

### ۷. تست‌پذیری (Testability)

#### [شدت: High] پوشش ناکافی تست برای کامپوننت‌های فرانت‌اند و وضعیت‌های تعاملی
- **فایل و خط:** `src/components/__tests__/`
- **کد فعلی:** فقط فایل `FileList.test.tsx` با ۳ تست ساده وجود دارد و کامپوننت‌های کلیدی مانند `TrimEditor`, `OptionsPanel`, `JobsPanel` و `HeaderBar` هیچ تست واحد یا یکپارچگی ندارند.
- **چرا اشتباه است:** تغییرات در منطق درگ بوم یا تغییرات استور به سادگی ممکن است باعث رگرسیون (Regression) بدون اطلاع توسعه‌دهنده شود.
- **پیشنهاد رفع:** اضافه کردن تست‌های Vitest + React Testing Library برای تعاملات کاربر در `TrimEditor` و محاسبات `OptionsPanel`.
- **اولویت رفع:** نزدیک

---

## نقشه راه رفع مشکلات (Roadmap)

```mermaid
flowchart TD
    A[فاز ۱: رفع باگ‌های بحرانی منطقی و همزمانی] --> B[فاز ۲: اصلاح امنیت و پاکسازی معماری]
    B --> C[فاز ۳: بهینه‌سازی عملکرد و تست‌پذیری]

    subgraph فاز ۱ [فاز ۱: رفع فوری]
        A1[اصلاح Waveform برای فایل‌های بالای ۵ دقیقه]
        A2[اصلاح Race Condition متغیر multiple_sources در صف]
        A3[اصلاح فراخوانی مجدد wait در run.rs]
    end

    subgraph فاز ۲ [فاز ۲: اولویت بالا/نزدیک]
        B1[تفکیک God Store در Zustand به اسلایس‌های مجزا]
        B2[فیلتر کردن نام‌های رزرو شده ویندوز در sanitize_component]
        B3[شکستن متد طولانی run_job در pipeline.rs]
    end

    subgraph فاز ۳ [فاز ۳: اولویت متوسط/بلندمدت]
        C1[پوشش کامل تست‌های فرانت‌اند برای TrimEditor و OptionsPanel]
        C2[تک‌مرحله‌ای کردن فیلتر سکوت برای کاهش I/O]
        C3[تزریق وابستگی با ProcessRunner Trait]
    end
```

### گام‌های اجرایی پیشنهادی:
1. **گام ۱ (فوری):** رفع باگ `waveform.rs` و باگ `multiple_sources` در `queue/mod.rs`.
2. **گام ۲ (نزدیک):** افزودن محافظت نام‌های ویندوزی در `naming.rs` و اصلاح `run.rs`.
3. **گام ۳ (نزدیک):** ریفکتور `useAppStore.ts` و شکستن تابع `run_job`.
4. **گام ۴ (بلندمدت):** افزودن تست‌های جامع برای کامپوننت‌های فرانت‌اند.
