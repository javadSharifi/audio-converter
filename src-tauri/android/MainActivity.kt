package com.audioconverter.app

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.system.Os
import android.util.Log
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream

class MainActivity : TauriActivity() {
  private external fun initNativePaths(nativeLibDir: String, cacheDir: String)

  private var nativePathsInitialized = false

  private fun initNativePathsSafe() {
    if (nativePathsInitialized) return
    try {
      initNativePaths(applicationInfo.nativeLibraryDir, cacheDir.absolutePath)
      nativePathsInitialized = true
    } catch (t: Throwable) {
      // The Rust .so may not be loaded yet (e.g. first onCreate before
      // Tauri's loadLibrary) — retry on the next resume.
      Log.w(TAG, "initNativePaths JNI call failed; will retry", t)
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

      // Clean up orphaned staged files from previous sessions / crashes
      cleanupStagingDirectory(this)

      // Notify Rust directly via JNI (idempotent; retried in onResume)
      initNativePathsSafe()

      // Check and request media permissions if needed
      checkAndRequestMediaPermissions()
    } catch (e: Throwable) {
      Log.e(TAG, "Failed to initialize MainActivity", e)
    }
    super.onCreate(savedInstanceState)
  }

  override fun onResume() {
    super.onResume()
    // Safety net: if the first attempt ran before the Rust lib was loaded,
    // initialize now that it certainly is (also re-registers after crash).
    initNativePathsSafe()
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
    } else { // Android 12 and below
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
        neededPermissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
      }
    }

    if (neededPermissions.isNotEmpty()) {
      Log.i(TAG, "Requesting media permissions: $neededPermissions")
      ActivityCompat.requestPermissions(this, neededPermissions.toTypedArray(), PERMISSION_REQ_CODE)
      return false
    }

    return true
  }

  companion object {
    private const val TAG = "AudioConverter"
    private const val PERMISSION_REQ_CODE = 1001
    private const val BUFFER_SIZE = 64 * 1024 // 64 KB buffer for fast stream transfers
    private const val SAFETY_MARGIN_BYTES = 50L * 1024 * 1024 // 50 MB safety margin

    /** Activity handle (cleared in onDestroy to avoid leaks). */
    var instance: MainActivity? = null

    /**
     * Application context — survives activity recreation, so background JNI
     * calls (staging, output publishing) work even while the UI restarts.
     * Holding an application context never leaks.
     */
    private var appContext: android.content.Context? = null

    /**
     * Show a toast on the MAIN thread. Toast.makeText from a background
     * (Looper-less) thread throws RuntimeException — and since these helpers
     * are invoked over JNI from Rust worker threads, an escaping exception
     * would leave a pending Java exception in native code (process abort).
     */
    private fun toastMain(resId: Int) {
      val ctx = appContext ?: return
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        try {
          Toast.makeText(ctx, ctx.getString(resId), Toast.LENGTH_LONG).show()
        } catch (t: Throwable) {
          Log.w(TAG, "Toast failed", t)
        }
      }
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
      val context = appContext ?: return joined
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

    @JvmStatic
    fun resolveUriToLocalPath(uriString: String): String {
      val context = appContext ?: return uriString
      try {
        // If already a regular accessible filesystem path
        if (!uriString.startsWith("content://") && !uriString.startsWith("file://")) {
          val f = File(uriString)
          if (f.exists() && f.canRead()) {
            return f.absolutePath
          }
        }

        val uri = Uri.parse(uriString)
        var fileName = "media_${System.currentTimeMillis()}"
        var reportedSize = 0L

        // 1. Query metadata: DISPLAY_NAME & SIZE from ContentResolver
        try {
          context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
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
          val mime = context.contentResolver.getType(uri)
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
        val destFile = File(stagingDir, "${System.currentTimeMillis()}_$safeName")

        Log.i(TAG, "Copying Content URI to local cache: $uriString -> ${destFile.absolutePath}")
        val inputStream = context.contentResolver.openInputStream(uri)
          ?: throw IllegalStateException("Cannot open input stream for $uriString (Permission denied or file unavailable)")

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
      } catch (e: SecurityException) {
        Log.e(TAG, "Permission denied while resolving URI: $uriString", e)
        toastMain(R.string.permission_denied_hint)
        return uriString
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to resolve URI to local path: $uriString", e)
        return uriString
      }
    }
  }
}
