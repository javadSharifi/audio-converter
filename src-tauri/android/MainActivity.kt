package com.audioconverter.app

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.provider.Settings
import android.system.Os
import android.util.Log
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream

@Keep
class MainActivity : TauriActivity() {
  private external fun initNativePaths(nativeLibDir: String, cacheDir: String)

  private var nativePathsInitialized = false
  private var nativeInitAttempts = 0

  private fun initNativePathsSafe() {
    if (nativePathsInitialized) return
    if (nativeInitAttempts >= MAX_NATIVE_INIT_ATTEMPTS) {
      Log.w(TAG, "Giving up on initNativePaths after $nativeInitAttempts attempts")
      return
    }
    nativeInitAttempts++
    try {
      initNativePaths(applicationInfo.nativeLibraryDir, cacheDir.absolutePath)
      nativePathsInitialized = true
    } catch (t: Throwable) {
      // The Rust .so may not be loaded yet (first onCreate can run before
      // Tauri's loadLibrary). Retry with backoff instead of relying on a
      // single onResume attempt — a dead bridge silently breaks every pick.
      Log.w(TAG, "initNativePaths JNI call failed; scheduling retry", t)
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
        { initNativePathsSafe() },
        RETRY_DELAY_MS
      )
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    instance = this
    appContext = applicationContext
    try {
      val nativeDir = applicationInfo.nativeLibraryDir
      val cDir = cacheDir.absolutePath
      val fDir = filesDir.absolutePath
      Log.i(TAG, "Initializing native paths -> nativeLibDir: $nativeDir, cacheDir: $cDir, filesDir: $fDir")

      // Set POSIX environment variables read by the Rust side
      Os.setenv("TAURI_ANDROID_NATIVE_LIB_DIR", nativeDir, true)
      Os.setenv("TAURI_ANDROID_CACHE_DIR", cDir, true)
      // Conversion outputs are written here, then published to
      // Music/AudioConverter (MediaStore) after each job succeeds.
      Os.setenv("TAURI_ANDROID_FILES_DIR", fDir, true)

      // Clean up orphaned staged files from previous sessions — ONLY on the
      // first onCreate of the process. Activity recreation (rotation, OEM
      // "Don't keep activities") must never wipe the current session's files.
      if (!sessionCleanupDone) {
        cleanupStagingDirectory(this)
        sessionCleanupDone = true
      }

      // Notify Rust directly via JNI (idempotent; retried in onResume)
      initNativePathsSafe()

      // Check and request media permissions if needed
      checkAndRequestMediaPermissions()

      // Handle incoming Open With (ACTION_VIEW) and share sheet (ACTION_SEND)
      handleIncomingIntent(intent)
    } catch (e: Throwable) {
      Log.e(TAG, "Failed to initialize MainActivity", e)
    }
    super.onCreate(savedInstanceState)
    try {
      configureWebViewSettings()
    } catch (_: Throwable) {}

    // Intercept the system Back button and let the WebView decide:
    // close fullscreen/sheets first, navigate home, and only exit on a
    // deliberate double-press (frontend shows the "press again" toast and
    // calls exitApp() when it really wants to quit).
    try {
      onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          dispatchBackToWebView()
        }
      })
    } catch (_: Throwable) {}
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingIntent(intent)
  }

  /**
   * Forward the hardware Back button to the frontend (`ac:android-back`).
   * The callback above consumes the press so the activity never finishes
   * accidentally from the song list — the frontend calls exitApp() only
   * after a confirmed double-press.
   */
  private fun dispatchBackToWebView() {
    try {
      val decor = window?.decorView ?: return
      decor.post {
        try {
          val webView = findWebView(decor)
          if (webView != null) {
            webView.evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('ac:android-back'));",
              null
            )
          }
        } catch (t: Throwable) {
          Log.w(TAG, "Failed to dispatch ac:android-back to WebView", t)
        }
      }
    } catch (t: Throwable) {
      Log.w(TAG, "dispatchBackToWebView failed", t)
    }
  }

  @Deprecated("Use OnBackPressedDispatcher callback instead")
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    // Consumed here for API < 33 devices without the dispatcher path —
    // forward to the WebView instead of finishing the activity.
    try {
      dispatchBackToWebView()
    } catch (_: Throwable) {
      super.onBackPressed()
    }
  }

  private fun handleIncomingIntent(intent: Intent?) {
    if (intent == null) return
    val action = intent.action ?: return
    val uris = mutableListOf<String>()

    if (Intent.ACTION_VIEW == action) {
      intent.data?.let { uri ->
        tryGrantUriPermission(uri, intent)
        uris.add(uri.toString())
      }
    } else if (Intent.ACTION_SEND == action) {
      val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_STREAM)
      } ?: intent.data

      uri?.let {
        tryGrantUriPermission(it, intent)
        uris.add(it.toString())
      }
    } else if (Intent.ACTION_SEND_MULTIPLE == action) {
      val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
      }
      list?.forEach { uri ->
        if (uri != null) {
          tryGrantUriPermission(uri, intent)
          uris.add(uri.toString())
        }
      }
    }

    if (uris.isNotEmpty()) {
      Log.i(TAG, "Received incoming open/share URIs: $uris")
      lastSharedUri = uris.first()
      synchronized(pendingOpenedUris) {
        pendingOpenedUris.addAll(uris)
      }
      notifyUrisToFrontend(uris)
    }
  }

  private fun tryGrantUriPermission(uri: Uri, intent: Intent) {
    if (android.content.ContentResolver.SCHEME_CONTENT == uri.scheme) {
      try {
        val flags = intent.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        if (flags != 0) {
          contentResolver.takePersistableUriPermission(uri, flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      } catch (_: SecurityException) {
        // Not a persistable URI, but transient read permission is already granted via Intent flags
      } catch (_: Throwable) {}
    }
  }

  private fun notifyUrisToFrontend(uris: List<String>) {
    val json = org.json.JSONArray(uris).toString()
    val decor = window?.decorView ?: return
    decor.post {
      try {
        val webView = findWebView(decor)
        if (webView != null) {
          val quoted = org.json.JSONObject.quote(json)
          val js = "window.dispatchEvent(new CustomEvent('ac:open-files', { detail: { paths: JSON.parse($quoted) } }));"
          webView.evaluateJavascript(js, null)
          Log.i(TAG, "Dispatched ac:open-files to WebView: $json")
        }
      } catch (t: Throwable) {
        Log.w(TAG, "Failed to dispatch ac:open-files to WebView", t)
      }
    }
  }

  override fun onResume() {
    super.onResume()
    instance = this
    initNativePathsSafe()
    try {
      configureWebViewSettings()
    } catch (_: Throwable) {}
  }

  private fun configureWebViewSettings() {
    val decor = window?.decorView ?: return
    decor.post {
      try {
        val webView = findWebView(decor)
        webView?.settings?.apply {
          mediaPlaybackRequiresUserGesture = false
          allowFileAccess = true
          allowContentAccess = true
          domStorageEnabled = true
          databaseEnabled = true
        }
        Log.i(TAG, "Configured WebView settings: mediaPlaybackRequiresUserGesture = false")
      } catch (t: Throwable) {
        Log.w(TAG, "configureWebViewSettings failed", t)
      }
    }
  }

  // internal (not private) so the companion push bridge
  // (dispatchPlayerState) can call it without visibility doubt.
  internal fun findWebView(view: android.view.View): android.webkit.WebView? {
    if (view is android.webkit.WebView) return view
    if (view is android.view.ViewGroup) {
      for (i in 0 until view.childCount) {
        val child = findWebView(view.getChildAt(i))
        if (child != null) return child
      }
    }
    return null
  }

  override fun onDestroy() {
    // Avoid leaking the Activity through the static handle.
    if (instance === this) {
      instance = null
    }
    super.onDestroy()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != PERMISSION_REQ_CODE) return

    if (grantResults.isEmpty()) {
      Log.w(TAG, "Permission request was cancelled/interrupted")
      return
    }

    val denied = permissions.filterIndexed { i, _ ->
      grantResults[i] != PackageManager.PERMISSION_GRANTED
    }
    if (denied.isEmpty()) {
      Log.i(TAG, "Media permissions granted")
    } else {
      Log.w(TAG, "Media permissions denied: $denied")
      toastMain(R.string.permission_denied_hint)
    }
  }

  fun checkAndRequestMediaPermissions(): Boolean {
    val neededPermissions = mutableListOf<String>()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { // Android 13+ (API 33+)
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        neededPermissions.add(Manifest.permission.READ_MEDIA_AUDIO)
      }
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
        neededPermissions.add(Manifest.permission.READ_MEDIA_VIDEO)
      }
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        neededPermissions.add(Manifest.permission.POST_NOTIFICATIONS)
      }
    } else { // Android 12 and below
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
        neededPermissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
      }
    }

    if (neededPermissions.isNotEmpty()) {
      Log.i(TAG, "Requesting media and notification permissions: $neededPermissions")
      ActivityCompat.requestPermissions(this, neededPermissions.toTypedArray(), PERMISSION_REQ_CODE)
      return false
    }

    return true
  }

  @Keep
  companion object {
    private const val TAG = "AudioConverter"
    private const val PERMISSION_REQ_CODE = 1001
    private const val BUFFER_SIZE = 64 * 1024 // 64 KB buffer for fast stream transfers
    private const val SAFETY_MARGIN_BYTES = 50L * 1024 * 1024 // 50 MB safety margin
    @Volatile
    var lastSharedUri: String? = null

    // Synchronized wrapper makes the list itself thread-safe; the reference
    // is never reassigned so @Volatile (var-only) must not be used here.
    val pendingOpenedUris: MutableList<String> = java.util.Collections.synchronizedList(mutableListOf())

    @JvmStatic
    @Keep
    fun drainPendingOpenedUris(): String {
      synchronized(pendingOpenedUris) {
        val json = org.json.JSONArray(pendingOpenedUris).toString()
        pendingOpenedUris.clear()
        return json
      }
    }

    init {
      try {
        System.loadLibrary("audio_converter")
        Log.i("AudioConverter", "Loaded audio_converter library in companion init")
      } catch (t: Throwable) {
        Log.w("AudioConverter", "Could not eagerly load audio_converter library", t)
      }
    }

    /** Activity handle (cleared in onDestroy to avoid leaks). */
    var instance: MainActivity? = null

    /** True once the staging dir was swept for this process lifetime. */
    private var sessionCleanupDone = false

    private const val RETRY_DELAY_MS = 300L
    private const val MAX_NATIVE_INIT_ATTEMPTS = 20

    /**
     * Application context — survives activity recreation, so background JNI
     * calls (staging, output publishing) work even while the UI restarts.
     * Holding an application context never leaks.
     */
    var appContext: android.content.Context? = null

    /**
     * Show a toast on the MAIN thread. Toast.makeText from a background
     * (Looper-less) thread throws RuntimeException — and since these helpers
     * are invoked over JNI from Rust worker threads, an escaping exception
     * would leave a pending Java exception in native code (process abort).
     */
    private fun toastMain(resId: Int) {
      val ctx = appContext ?: instance?.applicationContext ?: return
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        try {
          Toast.makeText(ctx, ctx.getString(resId), Toast.LENGTH_LONG).show()
        } catch (t: Throwable) {
          Log.w(TAG, "Toast failed", t)
        }
      }
    }

    @JvmStatic
    fun hasMediaPermissions(): Boolean {
      val ctx = appContext ?: instance?.applicationContext ?: return true
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED &&
          ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
      } else {
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
      }
    }

    @JvmStatic
    fun requestMediaPermissions() {
      val act = instance ?: return
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        act.checkAndRequestMediaPermissions()
      }
    }

    @JvmStatic
    fun openAppSettings() {
      val ctx = appContext ?: instance?.applicationContext ?: return
      try {
        val intent = android.content.Intent(
          android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.parse("package:${ctx.packageName}")
        ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
      } catch (t: Throwable) {
        Log.w(TAG, "openAppSettings failed", t)
      }
    }

    /** Finish the activity (double-back-to-exit confirmation from frontend). */
    @JvmStatic
    fun exitApp() {
      try {
        val act = instance
        if (act != null) {
          android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
              act.finish()
            } catch (t: Throwable) {
              Log.w(TAG, "exitApp finish failed", t)
            }
          }
        }
      } catch (t: Throwable) {
        Log.w(TAG, "exitApp failed", t)
      }
    }

    /**
     * Lightweight metadata lookup (name / size / duration) for picked URIs —
     * NO file copying. Used to populate the file list; actual staging happens
     * lazily right before each conversion runs.
     *
     * Output is one line per input: `name\tsize\tdurationMs\tok\tperm`
     * - `ok=1` even when SIZE is unknown (documents providers often omit it) —
     *   unknown size just becomes 0, never an error.
     * - `perm=1` when the failure was a missing media permission.
     */
    @JvmStatic
    fun statUri(joined: String): String {
      val context = appContext ?: instance?.applicationContext ?: return ""
      val resolver = instance?.contentResolver ?: context.contentResolver
      if (joined.isBlank()) return ""
      val out = ArrayList<String>()
      for (uriString in joined.split("\n")) {
        var name = ""
        var size = 0L
        var durationMs = 0L
        var ok = 1
        var perm = 0
        try {
          if (uriString.startsWith("/") || uriString.startsWith("file://")) {
            val filePath = if (uriString.startsWith("file://")) uriString.substring(7) else uriString
            val f = File(filePath)
            if (f.exists() && f.isFile) {
              name = f.name
              size = f.length()
              ok = 1
            } else {
              ok = 0
            }
          } else {
            val uri = Uri.parse(uriString)
            try {
              resolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
              )
            } catch (_: Throwable) {
            }
            try {
              resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                  val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                  if (ni >= 0 && !c.getString(ni).isNullOrBlank()) name = c.getString(ni)
                  val si = c.getColumnIndex(OpenableColumns.SIZE)
                  if (si >= 0 && !c.isNull(si)) size = c.getLong(si).coerceAtLeast(0)
                }
              } ?: run { ok = 0 }
            } catch (e: SecurityException) {
              Log.w(TAG, "statUri access denied for $uriString", e)
              ok = 0
              perm = 1
              toastMain(R.string.permission_denied_hint)
            } catch (e: Throwable) {
              Log.w(TAG, "statUri metadata query failed for $uriString", e)
              ok = 0
            }
            // Duration only exists on media-store collections; document URIs
            // throw on the unknown column — that just means "unknown duration".
            try {
              resolver.query(uri, arrayOf("duration"), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                  val di = c.getColumnIndex("duration")
                  if (di >= 0 && !c.isNull(di)) durationMs = c.getLong(di)
                }
              }
            } catch (_: Throwable) {
            }
            if (name.isNotEmpty() && !name.contains(".")) {
              val mime = resolver.getType(uri)
              val ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
              if (!ext.isNullOrBlank()) name = "$name.$ext"
            }
          }
          // Names must stay on ONE protocol line: strip line/field separators.
          name = name.replace(Regex("[\\n\\r\\t]"), " ")
        } catch (e: Throwable) {
          Log.w(TAG, "statUri failed for $uriString", e)
          ok = 0
        }
        out.add("$name\t$size\t$durationMs\t$ok\t$perm")
      }
      return out.joinToString("\n")
    }

    @JvmStatic
    fun cleanupStagingDirectory(context: android.content.Context) {
      try {
        val stagingDir = File(context.cacheDir, "staged_inputs")
        if (stagingDir.exists() && stagingDir.isDirectory) {
          val files = stagingDir.listFiles()
          if (files != null) {
            for (file in files) {
              file.delete()
            }
            Log.i(TAG, "Cleaned up ${files.size} orphaned staged files from cache")
          }
        }
      } catch (e: Throwable) {
        Log.w(TAG, "Error cleaning up staging directory", e)
      }
    }

    /** MIME type for an audio output extension (all our supported formats). */
    private fun mimeFor(ext: String): String = when (ext.lowercase()) {
      "mp3" -> "audio/mpeg"
      "aac" -> "audio/aac"
      "m4a" -> "audio/mp4"
      "opus" -> "audio/opus"
      "ogg" -> "audio/ogg"
      "wav" -> "audio/x-wav"
      "flac" -> "audio/flac"
      else -> "audio/mpeg"
    }

    /**
     * Publish finished outputs into the shared media collection
     * Music/AudioConverter via MediaStore — visible in any file manager
     * without any storage permission (API 29+). Input and result are
     * newline-joined path lists. Entries that cannot be published are
     * returned unchanged (the file stays in the app's internal dir).
     */
    @JvmStatic
    fun publishOutputs(joined: String): String {
      val context = appContext ?: instance?.applicationContext ?: return joined
      if (joined.isBlank()) return joined
      val results = ArrayList<String>()
      for (path in joined.split("\n")) {
        try {
          val src = File(path)
          // Only publish files produced by our own internal output dir.
          if (!src.exists() || !src.absolutePath.startsWith(context.filesDir.absolutePath)) {
            results.add(path)
            continue
          }

          val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME, src.name)
            put(android.provider.MediaStore.Audio.Media.MIME_TYPE, mimeFor(src.extension))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
              put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH, "Music/AudioConverter")
            }
          }
          val uri = context.contentResolver.insert(
            android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values
          )
          if (uri == null) {
            Log.w(TAG, "MediaStore insert failed for $path")
            results.add(path)
            continue
          }

          val copied = context.contentResolver.openOutputStream(uri)?.use { os ->
            src.inputStream().use { input ->
              input.copyTo(os, BUFFER_SIZE)
              true
            }
          } ?: false
          if (!copied) {
            Log.w(TAG, "Copy to MediaStore failed for $path")
            // Remove the just-inserted row — never leave a ghost entry in
            // the user's music library.
            try {
              context.contentResolver.delete(uri, null, null)
            } catch (t: Throwable) {
              Log.w(TAG, "Could not clean up MediaStore row $uri", t)
            }
            results.add(path)
            continue
          }

          val published = "Music/AudioConverter/${src.name}"
          Log.i(TAG, "Published output: $path -> $published")
          if (!src.delete()) {
            Log.w(TAG, "Internal output copy could not be removed: $path")
          }
          results.add(published)
        } catch (e: Throwable) {
          Log.w(TAG, "publishOutputs failed for $path", e)
          results.add(path)
        }
      }
      return results.joinToString("\n")
    }

    /**
     * Stable cache file for a track's embedded artwork (Namida-style artwork
     * cache: one JPEG per track under `cacheDir/artworks/`). The same naming
     * is used by PlaybackService for notification art, so a cover resolved
     * once (list UI) is reused by the media notification for free.
     */
    fun artworkCacheFileFor(cacheKey: String): java.io.File? {
      try {
        if (cacheKey.isBlank()) return null
        val context = appContext ?: instance?.applicationContext ?: return null
        val dir = java.io.File(context.cacheDir, "artworks")
        if (!dir.exists()) dir.mkdirs()
        // kotlin.String.hashCode is stable across runs for the same content.
        val name = "art_" + Math.abs(cacheKey.hashCode()).toString() + ".jpg"
        return java.io.File(dir, name)
      } catch (_: Throwable) {
        return null
      }
    }

    /**
     * Extract the embedded picture (ID3/APIC, Vorbis, MP4 covr, ...) of one
     * audio file and cache it as JPEG. `audioRef` is the track uri
     * (`content://...`) or a plain/`file://` path — never an artwork URI.
     * Returns the absolute cached file path, or "" when there is no embedded
     * art. Never throws over JNI. Single-String-arg on purpose so the
     * existing Rust `call_static_string_quiet` bridge can call it directly.
     */
    @JvmStatic
    fun getEmbeddedArtwork(audioRef: String): String {
      try {
        if (audioRef.isBlank()) return ""
        val out = artworkCacheFileFor(audioRef) ?: return ""
        if (out.exists() && out.length() > 0) return out.absolutePath
        val context = appContext ?: instance?.applicationContext ?: return ""
        val retriever = android.media.MediaMetadataRetriever()
        try {
          if (audioRef.startsWith("content://")) {
            retriever.setDataSource(context, Uri.parse(audioRef))
          } else {
            val rawPath = if (audioRef.startsWith("file://")) {
              Uri.parse(audioRef).path ?: audioRef
            } else {
              audioRef
            }
            if (rawPath.isBlank()) return ""
            retriever.setDataSource(rawPath)
          }
          val bytes = retriever.embeddedPicture ?: return ""
          if (bytes.isEmpty()) return ""
          java.io.FileOutputStream(out).use { it.write(bytes) }
        } finally {
          try {
            retriever.release()
          } catch (_: Throwable) {}
        }
        return if (out.exists() && out.length() > 0) out.absolutePath else ""
      } catch (t: Throwable) {
        Log.w(TAG, "getEmbeddedArtwork failed", t)
        return ""
      }
    }

    /**
     * Whether system notifications are currently allowed for this app
     * (Android 13+ runtime `POST_NOTIFICATIONS`). The media notification —
     * and with it the lock-screen player — silently disappears when this is
     * denied, while in-app playback keeps working, so the frontend shows a
     * guidance banner instead of a broken-looking player.
     */
    @JvmStatic
    fun areNotificationsEnabled(): Boolean {
      try {
        val context = appContext ?: instance?.applicationContext ?: return true
        return androidx.core.app.NotificationManagerCompat.from(context)
          .areNotificationsEnabled()
      } catch (_: Throwable) {
        return true
      }
    }

    @JvmStatic
    fun checkMusicPermission(): String {
      val context = appContext ?: instance?.applicationContext ?: return "granted"
      val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Manifest.permission.READ_MEDIA_AUDIO
      } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
      }
      return if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) {
        "granted"
      } else {
        "denied"
      }
    }

    @JvmStatic
    fun queryMediaStoreMusic(): String {
      val context = appContext ?: instance?.applicationContext ?: return "[]"
      val resolver = instance?.contentResolver ?: context.contentResolver
      val tracks = ArrayList<String>()

      val projection = arrayOf(
        android.provider.MediaStore.Audio.Media._ID,
        android.provider.MediaStore.Audio.Media.TITLE,
        android.provider.MediaStore.Audio.Media.ARTIST,
        android.provider.MediaStore.Audio.Media.ALBUM,
        android.provider.MediaStore.Audio.Media.DURATION,
        android.provider.MediaStore.Audio.Media.SIZE,
        android.provider.MediaStore.Audio.Media.MIME_TYPE,
        android.provider.MediaStore.Audio.Media.DISPLAY_NAME,
        android.provider.MediaStore.Audio.Media.DATE_ADDED,
        android.provider.MediaStore.Audio.Media.DATE_MODIFIED,
        android.provider.MediaStore.Audio.Media.ALBUM_ID,
        android.provider.MediaStore.Audio.Media.DATA
      )

      val selection = "${android.provider.MediaStore.Audio.Media.IS_MUSIC} != 0"
      val sortOrder = "${android.provider.MediaStore.Audio.Media.DATE_ADDED} DESC"

      try {
        resolver.query(
          android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          projection,
          selection,
          null,
          sortOrder
        )?.use { cursor ->
          val idCol = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Media._ID)
          val titleCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.TITLE)
          val artistCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.ARTIST)
          val albumCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.ALBUM)
          val durCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DURATION)
          val sizeCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.SIZE)
          val mimeCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.MIME_TYPE)
          val nameCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DISPLAY_NAME)
          val addedCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DATE_ADDED)
          val modCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DATE_MODIFIED)
          val albumIdCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.ALBUM_ID)
          val dataCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DATA)

          while (cursor.moveToNext()) {
            val id = cursor.getLong(idCol)
            val uri = android.content.ContentUris.withAppendedId(
              android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
              id
            ).toString()

            val title = if (titleCol >= 0) cursor.getString(titleCol) else null
            val artist = if (artistCol >= 0) cursor.getString(artistCol) else null
            val album = if (albumCol >= 0) cursor.getString(albumCol) else null
            val dur = if (durCol >= 0) cursor.getLong(durCol) else 0L
            val size = if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L
            val mime = if (mimeCol >= 0) cursor.getString(mimeCol) ?: "audio/mpeg" else "audio/mpeg"
            val name = if (nameCol >= 0) cursor.getString(nameCol) ?: "Track $id" else "Track $id"
            val added = if (addedCol >= 0) cursor.getLong(addedCol) * 1000L else 0L
            val mod = if (modCol >= 0) cursor.getLong(modCol) * 1000L else added
            val albumId = if (albumIdCol >= 0) cursor.getLong(albumIdCol) else -1L
            val coverUri = if (albumId > 0) "content://media/external/audio/albumart/$albumId" else null
            val rawPath = if (dataCol >= 0) cursor.getString(dataCol) else null
            val validPath = if (!rawPath.isNullOrBlank() && File(rawPath).exists() && File(rawPath).canRead()) rawPath else null

            val ext = if (name.contains('.')) name.substringAfterLast('.').lowercase() else "mp3"

            val json = org.json.JSONObject().apply {
              put("id", "android_$id")
              put("uri", uri)
              put("path", if (validPath != null) validPath else org.json.JSONObject.NULL)
              put("name", name)
              put("title", if (!title.isNullOrBlank()) title else name)
              put("artist", if (!artist.isNullOrBlank() && artist != "<unknown>") artist else org.json.JSONObject.NULL)
              put("album", if (!album.isNullOrBlank() && album != "<unknown>") album else org.json.JSONObject.NULL)
              put("durationSecs", dur / 1000.0)
              put("sizeBytes", size)
              put("mimeType", mime)
              put("format", ext)
              put("createdTimestampMs", added)
              put("modifiedTimestampMs", mod)
              put("coverUrl", if (coverUri != null) coverUri else org.json.JSONObject.NULL)
            }
            tracks.add(json.toString())
          }
        }
      } catch (e: Throwable) {
        Log.e(TAG, "queryMediaStoreMusic failed", e)
      }

      return "[" + tracks.joinToString(",") + "]"
    }

    @JvmStatic
    fun resolveUriToLocalPath(uriString: String): String {
      val context = appContext ?: instance?.applicationContext ?: return uriString
      // Plain filesystem path → use it as-is.
      if (!uriString.startsWith("content://") && !uriString.startsWith("file://")) {
        val f = File(uriString)
        if (f.exists() && f.canRead()) {
          return f.absolutePath
        }
      }
      // file:// URI → decode to its absolute path, but ONLY when it is
      // actually readable (scoped storage can hand back paths that exist on
      // disk yet deny access).
      if (uriString.startsWith("file://")) {
        val decoded = Uri.parse(uriString).path
        if (decoded != null && File(decoded).canRead()) {
          return decoded
        }
        Log.w(TAG, "file:// URI is not readable: $uriString")
        return "STAGE_ERROR|file is not readable"
      }
      return try {
        try {
          stageUriToCache(context, uriString)
        } catch (e: SecurityException) {
          Log.e(TAG, "Permission denied while resolving URI: $uriString", e)
          toastMain(R.string.permission_denied_hint)
          "STAGE_ERROR|permission denied by system"
        } catch (e: Throwable) {
          Log.e(TAG, "Failed to resolve URI to local path: $uriString", e)
          "STAGE_ERROR|${e.message ?: e.javaClass.simpleName}"
        }
      } catch (e: Throwable) {
        // Never let an exception escape over JNI (pending exception = abort).
        Log.e(TAG, "resolveUriToLocalPath hard failure", e)
        "STAGE_ERROR|unexpected error"
      }
    }

    private fun stageUriToCache(context: android.content.Context, uriString: String): String {
      val resolver = instance?.contentResolver ?: context.contentResolver
      val uri = Uri.parse(uriString)
      var fileName = "media_${System.currentTimeMillis()}"
      var reportedSize = 0L

      try {
        resolver.takePersistableUriPermission(
          uri,
          android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      } catch (_: Throwable) {
      }

      // 1. Query metadata: DISPLAY_NAME & SIZE from ContentResolver
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0) {
              val name = cursor.getString(nameIndex)
              if (!name.isNullOrBlank()) {
                fileName = name
              }
            }
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0) {
              reportedSize = cursor.getLong(sizeIndex)
            }
          }
        }
      } catch (e: Throwable) {
        Log.w(TAG, "Could not query ContentResolver metadata for $uriString", e)
      }

      // If fileName lacks extension, infer from mimeType
      if (!fileName.contains(".")) {
        val mime = resolver.getType(uri)
        val ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
        if (!ext.isNullOrBlank()) {
          fileName = "$fileName.$ext"
        }
      }

      // 2. Pre-check cache storage capacity
      val availableCacheSpace = context.cacheDir.usableSpace
      Log.i(TAG, "Staging $fileName ($reportedSize bytes). Available cache: $availableCacheSpace bytes")
      if (reportedSize > 0 && availableCacheSpace < (reportedSize + SAFETY_MARGIN_BYTES)) {
        throw IllegalStateException(
          "Insufficient cache storage space. Required: ${reportedSize / (1024 * 1024)} MB, Available: ${availableCacheSpace / (1024 * 1024)} MB"
        )
      }

      val stagingDir = File(context.cacheDir, "staged_inputs")
      if (!stagingDir.exists()) {
        stagingDir.mkdirs()
      }

      // Keep Unicode (e.g. Persian) titles — only strip filesystem-illegal
      // and control characters so output names stay meaningful.
      val safeName = fileName.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_")
      val dot = safeName.lastIndexOf('.')
      val stem = if (dot > 0) safeName.substring(0, dot) else safeName
      val ext = if (dot > 0) safeName.substring(dot) else ""
      var destFile = File(stagingDir, safeName)

      // Reuse if already staged with matching non-zero size
      if (destFile.exists() && destFile.length() > 0 && (reportedSize <= 0 || destFile.length() == reportedSize)) {
        Log.i(TAG, "Reusing already staged file: ${destFile.absolutePath}")
        return destFile.absolutePath
      }

      var n = 1
      var claimed = destFile.createNewFile()
      while (!claimed) {
        destFile = File(stagingDir, "$stem ($n)$ext")
        if (destFile.exists() && destFile.length() > 0 && (reportedSize <= 0 || destFile.length() == reportedSize)) {
          Log.i(TAG, "Reusing already staged file: ${destFile.absolutePath}")
          return destFile.absolutePath
        }
        claimed = destFile.createNewFile()
        n++
      }

      Log.i(TAG, "Copying Content URI to local cache: $uriString -> ${destFile.absolutePath}")
      val inputStream = try {
        resolver.openInputStream(uri)
      } catch (t: Throwable) {
        Log.w(TAG, "openInputStream failed, trying openFileDescriptor", t)
        null
      } ?: try {
        resolver.openFileDescriptor(uri, "r")?.let { pfd ->
          java.io.FileInputStream(pfd.fileDescriptor)
        }
      } catch (t: Throwable) {
        Log.w(TAG, "openFileDescriptor also failed", t)
        null
      } ?: throw IllegalStateException("Cannot open input stream for $uriString (Permission denied or file unavailable)")

      inputStream.use { input ->
        FileOutputStream(destFile).use { output ->
          val buffer = ByteArray(BUFFER_SIZE)
          var bytesRead: Int
          while (input.read(buffer).also { bytesRead = it } != -1) {
            output.write(buffer, 0, bytesRead)
          }
          output.flush()
        }
      }

      Log.i(TAG, "Staging completed successfully: ${destFile.absolutePath} (${destFile.length()} bytes)")
      return destFile.absolutePath
    }

    @JvmStatic
    fun deleteAudioTrack(uriString: String): String {
      val context = appContext ?: instance?.applicationContext ?: return "Context unavailable"
      // Drop the cached embedded artwork too: the same uri key could later be
      // reused by MediaStore for a different file, which would otherwise
      // inherit the deleted track's cover (in lists and notifications).
      try {
        artworkCacheFileFor(uriString)?.delete()
      } catch (_: Throwable) {}
      return try {
        val resolver = instance?.contentResolver ?: context.contentResolver
        if (uriString.startsWith("content://")) {
          val uri = Uri.parse(uriString)
          val deletedRows = resolver.delete(uri, null, null)
          if (deletedRows > 0) {
            "OK"
          } else {
            "Delete returned 0 rows"
          }
        } else {
          val file = File(if (uriString.startsWith("file://")) Uri.parse(uriString).path ?: uriString else uriString)
          if (file.exists() && file.delete()) {
            "OK"
          } else {
            "Could not delete local file"
          }
        }
      } catch (e: SecurityException) {
        Log.w(TAG, "Delete audio track threw SecurityException on $uriString", e)
        "SECURITY_EXCEPTION"
      } catch (e: Throwable) {
        Log.e(TAG, "Delete audio track failed on $uriString", e)
        e.message ?: "Unknown error"
      }
    }

    @JvmStatic
    fun setAsRingtone(uriString: String): String {
      val context = appContext ?: instance?.applicationContext ?: return "Context unavailable"
      return try {
        if (!Settings.System.canWrite(context)) {
          val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS).apply {
            data = Uri.parse("package:" + context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(intent)
          return "PERMISSION_REQUIRED"
        }

        val uri = Uri.parse(uriString)
        val resolver = instance?.contentResolver ?: context.contentResolver

        try {
          val values = ContentValues().apply {
            put(android.provider.MediaStore.Audio.Media.IS_RINGTONE, true)
          }
          resolver.update(uri, values, null, null)
        } catch (_: Throwable) {}

        RingtoneManager.setActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE, uri)
        "OK"
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to set as ringtone: $uriString", e)
        e.message ?: "Unknown error"
      }
    }

    /**
     * Share one audio track via the system sheet. Single-String-arg overload
     * for the Rust `call_static_string_quiet` bridge: `jsonArgs` is either
     * `{"uri":..,"title":..,"mimeType":..}` (what Rust sends) or a bare uri
     * (the retry fallback). The audio is staged into our cache and served
     * through our FileProvider — raw URIs are never handed out: file://
     * crashes on API 24+ (FileUriExposedException) and bare content:// grants
     * are flaky without ClipData + per-package grants (share_plus pattern).
     * Returns "OK" or an error string. Never throws over JNI.
     */
    @JvmStatic
    fun shareAudioTrack(jsonArgs: String): String {
      val context = appContext ?: instance?.applicationContext ?: return "Context unavailable"
      return try {
        var uriString = jsonArgs
        var title = "Audio Track"
        var mimeType = "audio/*"
        try {
          val trimmed = jsonArgs.trim()
          if (trimmed.startsWith("{")) {
            val obj = org.json.JSONObject(trimmed)
            uriString = obj.optString("uri", jsonArgs)
            val t = obj.optString("title", "")
            if (t.isNotBlank()) title = t
            val m = obj.optString("mimeType", "")
            if (m.isNotBlank()) mimeType = m
          }
        } catch (_: Throwable) {}
        if (uriString.isBlank()) return "Empty track reference"
        if (uriString.startsWith("http://") || uriString.startsWith("https://")) {
          return "Streaming tracks cannot be shared"
        }

        // 1. Display name for the staged copy.
        val resolver = instance?.contentResolver ?: context.contentResolver
        var displayName: String? = null
        if (uriString.startsWith("content://")) {
          try {
            resolver.query(
              Uri.parse(uriString),
              arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
            )?.use { c ->
              if (c.moveToFirst()) {
                val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (ni >= 0) displayName = c.getString(ni)
              }
            }
          } catch (_: Throwable) {}
        } else {
          val raw = if (uriString.startsWith("file://")) Uri.parse(uriString).path else uriString
          if (!raw.isNullOrBlank()) displayName = java.io.File(raw).name.takeIf { it.isNotBlank() }
        }
        if (displayName.isNullOrBlank()) {
          val ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
          displayName = "shared_audio" + if (!ext.isNullOrBlank()) ".$ext" else ".mp3"
        }
        val safeName = displayName!!.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_")

        // 2. Stage into our own cache so FileProvider can serve it.
        val shareDir = java.io.File(context.cacheDir, "share_tmp")
        try {
          if (shareDir.exists()) {
            shareDir.listFiles()?.forEach {
              try {
                it.delete()
              } catch (_: Throwable) {}
            }
          } else {
            shareDir.mkdirs()
          }
        } catch (_: Throwable) {}
        val destFile = java.io.File(shareDir, safeName)
        val inputStream = try {
          if (uriString.startsWith("content://")) {
            resolver.openInputStream(Uri.parse(uriString))
          } else {
            val raw = if (uriString.startsWith("file://")) Uri.parse(uriString).path ?: uriString else uriString
            java.io.FileInputStream(java.io.File(raw))
          }
        } catch (t: Throwable) {
          Log.w(TAG, "shareAudioTrack: cannot open source", t)
          null
        } ?: return "Cannot read this audio file"
        try {
          inputStream.use { input ->
            java.io.FileOutputStream(destFile).use { output ->
              val buffer = ByteArray(BUFFER_SIZE)
              var n: Int
              while (input.read(buffer).also { n = it } != -1) output.write(buffer, 0, n)
              output.flush()
            }
          }
        } catch (t: Throwable) {
          Log.w(TAG, "shareAudioTrack: staging failed", t)
          try {
            destFile.delete()
          } catch (_: Throwable) {}
          return "Cannot read this audio file"
        }
        if (!destFile.exists() || destFile.length() <= 0) {
          try {
            destFile.delete()
          } catch (_: Throwable) {}
          return "Cannot read this audio file"
        }

        // 3. Serve via FileProvider with explicit grants.
        val contentUri = try {
          androidx.core.content.FileProvider.getUriForFile(
            context, context.packageName + ".fileprovider", destFile
          )
        } catch (t: Throwable) {
          Log.w(TAG, "shareAudioTrack: FileProvider failed", t)
          try {
            destFile.delete()
          } catch (_: Throwable) {}
          return "Cannot prepare file for sharing"
        }
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
          type = mimeType
          putExtra(Intent.EXTRA_STREAM, contentUri)
          putExtra(Intent.EXTRA_SUBJECT, title)
          clipData = android.content.ClipData.newUri(context.contentResolver, title, contentUri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        // Per-package grants: the chooser target resolves later, so grant to
        // every candidate (share_plus does the same loop).
        try {
          val candidates =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              context.packageManager.queryIntentActivities(
                shareIntent,
                android.content.pm.PackageManager.ResolveInfoFlags.of(
                  android.content.pm.PackageManager.MATCH_DEFAULT_ONLY.toLong()
                )
              )
            } else {
              @Suppress("DEPRECATION")
              context.packageManager.queryIntentActivities(
                shareIntent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY
              )
            }
          for (info in candidates) {
            try {
              context.grantUriPermission(
                info.activityInfo.packageName, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
              )
            } catch (_: Throwable) {}
          }
        } catch (_: Throwable) {}
        val chooser = Intent.createChooser(shareIntent, title).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
          context.startActivity(chooser)
        } catch (t: Throwable) {
          Log.w(TAG, "shareAudioTrack: no app to share with", t)
          return "No app available to share with"
        }
        "OK"
      } catch (t: Throwable) {
        Log.e(TAG, "Failed to share audio track", t)
        t.message ?: "Unknown error"
      }
    }

    @JvmStatic
    fun shareAudioTrack(uriString: String, title: String, mimeType: String): String {
      val context = appContext ?: instance?.applicationContext ?: return "Context unavailable"
      return try {
        val uri = Uri.parse(uriString)
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
          type = if (mimeType.isNotBlank()) mimeType else "audio/*"
          putExtra(Intent.EXTRA_STREAM, uri)
          putExtra(Intent.EXTRA_SUBJECT, title)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val chooser = Intent.createChooser(shareIntent, title).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
        "OK"
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to share audio track: $uriString", e)
        e.message ?: "Unknown error"
      }
    }

    // --- Jetpack Media3 Playback Bridge Methods ---

    @JvmStatic
    fun nativePlayerPlay(trackJson: String, playlistJson: String, startIndex: Int): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.playTrack(ctx, trackJson, playlistJson, startIndex)
    }

    @JvmStatic
    fun nativePlayerPause(): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.pause(ctx)
    }

    @JvmStatic
    fun nativePlayerResume(): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.resume(ctx)
    }

    @JvmStatic
    fun nativePlayerSeekTo(positionMs: Long): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.seekTo(ctx, positionMs)
    }

    @JvmStatic
    fun nativePlayerNext(): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.next(ctx)
    }

    @JvmStatic
    fun nativePlayerPrevious(): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.previous(ctx)
    }

    @JvmStatic
    fun nativePlayerSetRepeatMode(mode: String): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.setRepeatMode(ctx, mode)
    }

    @JvmStatic
    fun nativePlayerSetShuffleMode(enabled: Boolean): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.setShuffleMode(ctx, enabled)
    }

    @JvmStatic
    fun nativePlayerSetSpeed(speed: Float): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.setPlaybackSpeed(ctx, speed)
    }

    @JvmStatic
    fun nativePlayerSetVolume(volume: Float): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.setVolume(ctx, volume)
    }

    @JvmStatic
    fun nativePlayerSetBoosterGain(gainDb: Float): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.setBoosterGain(ctx, gainDb)
    }

    @JvmStatic
    fun nativePlayerStop(): String {
      val ctx = appContext ?: instance?.applicationContext ?: return "CONTEXT_NULL"
      return PlaybackService.stop(ctx)
    }

    @JvmStatic
    fun nativePlayerGetState(): String {
      return PlaybackService.getCurrentStateJson()
    }

    /**
     * Push bridge: PlaybackService -> WebView React engine.
     * Mirrors Rhythm's service->UI callback fan-out (MediaController
     * listeners -> StateFlow) using the same CustomEvent transport this
     * activity already uses for open-files/share. Polling stays as fallback
     * because WebView timers stall in background, but pushes make
     * notification/lock-screen taps reflect instantly when visible.
     */
    @JvmStatic
    fun dispatchPlayerState(stateJson: String) {
      if (stateJson.isBlank()) return
      try {
        val act = instance ?: return
        // Never touch a finishing/destroyed Activity — evaluating JS on a
        // dead WebView is a crash ("keeps stopping") on some OEM firmwares.
        try {
          if (act.isFinishing || act.isDestroyed) return
        } catch (_: Throwable) {}
        val decor = try {
          act.window?.decorView
        } catch (_: Throwable) {
          null
        } ?: return
        decor.post {
          try {
            val webView = act.findWebView(act.window?.decorView ?: return@post)
            if (webView != null) {
              val quoted = org.json.JSONObject.quote(stateJson)
              val js =
                "window.dispatchEvent(new CustomEvent('ac:player-state', { detail: JSON.parse($quoted) }));"
              webView.evaluateJavascript(js, null)
            }
          } catch (t: Throwable) {
            Log.w(TAG, "dispatchPlayerState to WebView failed", t)
          }
        }
      } catch (t: Throwable) {
        Log.w(TAG, "dispatchPlayerState failed", t)
      }
    }
  }
}
