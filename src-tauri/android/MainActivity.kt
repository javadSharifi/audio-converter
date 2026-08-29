package com.audioconverter.app

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.system.Os
import android.util.Log
import app.tauri.plugin.PluginManager
import java.io.File
import java.io.FileOutputStream

class MainActivity : TauriActivity() {
  private external fun initNativePaths(nativeLibDir: String, cacheDir: String)

  override fun onCreate(savedInstanceState: Bundle?) {
    instance = this
    try {
      val nativeDir = applicationInfo.nativeLibraryDir
      val cDir = cacheDir.absolutePath
      Log.i(TAG, "Initializing native paths -> nativeLibDir: $nativeDir, cacheDir: $cDir")
      
      // Set POSIX environment variables
      Os.setenv("TAURI_ANDROID_NATIVE_LIB_DIR", nativeDir, true)
      Os.setenv("TAURI_ANDROID_CACHE_DIR", cDir, true)
      
      // Also notify Rust directly via JNI
      try {
        initNativePaths(nativeDir, cDir)
      } catch (t: Throwable) {
        Log.w(TAG, "initNativePaths JNI call failed (safe fallback to env vars)", t)
      }
    } catch (e: Throwable) {
      Log.e(TAG, "Failed to set native environment variables", e)
    }
    super.onCreate(savedInstanceState)
  }

  companion object {
    private const val TAG = "AudioConverter"
    var instance: MainActivity? = null

    @JvmStatic
    fun resolveUriToLocalPath(uriString: String): String {
      val context = instance ?: return uriString
      try {
        if (!uriString.startsWith("content://") && !uriString.startsWith("file://")) {
          val f = File(uriString)
          if (f.exists() && f.canRead()) {
            return f.absolutePath
          }
        }

        val uri = Uri.parse(uriString)
        var fileName = "audio_${System.currentTimeMillis()}"
        
        // Query original display name
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0) {
              val name = cursor.getString(nameIndex)
              if (!name.isNullOrBlank()) {
                fileName = name
              }
            }
          }
        }

        val stagingDir = File(context.cacheDir, "staged_inputs")
        if (!stagingDir.exists()) {
          stagingDir.mkdirs()
        }

        // Sanitize file name but keep standard extensions
        val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val destFile = File(stagingDir, "${System.currentTimeMillis()}_$safeName")
        
        Log.i(TAG, "Staging Android URI $uriString -> ${destFile.absolutePath}")
        context.contentResolver.openInputStream(uri)?.use { input ->
          FileOutputStream(destFile).use { output ->
            input.copyTo(output)
          }
        }

        return destFile.absolutePath
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to resolve URI to local path: $uriString", e)
        return uriString
      }
    }
  }
}
