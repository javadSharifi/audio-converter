package com.audioconverter.app

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.system.Os
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

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
      
      // Clean up orphaned staged files from previous sessions / crashes
      cleanupStagingDirectory(this)

      // Notify Rust directly via JNI
      try {
        initNativePaths(nativeDir, cDir)
      } catch (t: Throwable) {
        Log.w(TAG, "initNativePaths JNI call fallback to env vars", t)
      }

      // Check and request media permissions if needed
      checkAndRequestMediaPermissions()
    } catch (e: Throwable) {
      Log.e(TAG, "Failed to initialize MainActivity", e)
    }
    super.onCreate(savedInstanceState)
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

    var instance: MainActivity? = null

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

    @JvmStatic
    fun deleteStagedFile(filePath: String): Boolean {
      return try {
        val f = File(filePath)
        if (f.exists() && f.parentFile?.name == "staged_inputs") {
          val deleted = f.delete()
          Log.i(TAG, "Deleted staged file $filePath: $deleted")
          deleted
        } else {
          false
        }
      } catch (e: Throwable) {
        Log.w(TAG, "Failed to delete staged file $filePath", e)
        false
      }
    }

    @JvmStatic
    fun resolveUriToLocalPath(uriString: String): String {
      val context = instance ?: return uriString
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

        val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
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
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to resolve URI to local path: $uriString", e)
        return uriString
      }
    }
  }
}
