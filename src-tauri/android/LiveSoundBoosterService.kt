package com.audioconverter.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.Keep
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicBoolean

@Keep
class LiveSoundBoosterService : Service() {

  companion object {
    private const val TAG = "LiveSoundBooster"
    private const val NOTIFICATION_ID = 2001
    private const val CHANNEL_ID = "sound_booster_live_channel"

    const val ACTION_START = "com.audioconverter.app.action.START_LIVE_BOOST"
    const val ACTION_STOP = "com.audioconverter.app.action.STOP_LIVE_BOOST"
    const val ACTION_UPDATE_GAIN = "com.audioconverter.app.action.UPDATE_GAIN"

    const val EXTRA_RESULT_CODE = "extra_result_code"
    const val EXTRA_DATA_INTENT = "extra_data_intent"
    const val EXTRA_GAIN = "extra_gain"

    @Volatile
    var isServiceRunning = false
      private set

    @Volatile
    var currentGain = 1.5f
  }

  private var mediaProjection: MediaProjection? = null
  private var audioRecord: AudioRecord? = null
  private var audioTrack: AudioTrack? = null
  private var processingThread: Thread? = null
  private val isRunning = AtomicBoolean(false)
  private val startLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        synchronized(startLock) {
          if (isRunning.get() || isServiceRunning) {
            Log.w(TAG, "Duplicate start ignored — already running")
            return START_NOT_STICKY
          }
        }
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val dataIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(EXTRA_DATA_INTENT, Intent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(EXTRA_DATA_INTENT)
        }
        val gain = intent.getFloatExtra(EXTRA_GAIN, 1.5f)
        currentGain = gain.coerceIn(1.0f, 4.0f)

        if (resultCode != 0 && dataIntent != null) {
          startBooster(resultCode, dataIntent)
        } else {
          Log.e(TAG, "Missing MediaProjection data in ACTION_START")
          stopSelf()
        }
      }
      ACTION_UPDATE_GAIN -> {
        val gain = intent.getFloatExtra(EXTRA_GAIN, currentGain)
        currentGain = gain.coerceIn(1.0f, 4.0f)
        Log.i(TAG, "Live booster gain updated to $currentGain")
        updateNotification()
      }
      ACTION_STOP -> {
        stopBooster()
      }
    }
    return START_NOT_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val name = "Sound Booster Live"
      val descriptionText = "Notifications for Live System Audio Booster"
      val importance = NotificationManager.IMPORTANCE_LOW
      val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
        description = descriptionText
        setShowBadge(false)
      }
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val stopIntent = Intent(this, LiveSoundBoosterService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPendingIntent = PendingIntent.getService(
      this, 0, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
    val openPendingIntent = PendingIntent.getActivity(
      this, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val gainDb = (20 * Math.log10(currentGain.toDouble())).toInt()

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("🔊 Sound Booster فعال است (+${gainDb} dB)")
      .setContentText("تقویت صدای رسانه‌ها در حال اجراست")
      .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
      .setContentIntent(openPendingIntent)
      .addAction(android.R.drawable.ic_delete, "Stop / توقف", stopPendingIntent)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun updateNotification() {
    if (isServiceRunning) {
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      notificationManager.notify(NOTIFICATION_ID, buildNotification())
    }
  }

  private fun cleanupAfterFailedStart() {
    try { audioRecord?.release() } catch (_: Throwable) {}
    audioRecord = null
    try { audioTrack?.release() } catch (_: Throwable) {}
    audioTrack = null
    try { mediaProjection?.stop() } catch (_: Throwable) {}
    mediaProjection = null
    isRunning.set(false)
    isServiceRunning = false
  }

  private fun startBooster(resultCode: Int, dataIntent: Intent) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      Log.e(TAG, "AudioPlaybackCapture requires Android 10 (API 29)+")
      stopSelf()
      return
    }

    synchronized(startLock) {
      if (isRunning.get()) {
        Log.w(TAG, "startBooster ignored — already running")
        return
      }
      // Reserve the slot immediately so rapid ACTION_STARTs can't both pass;
      // every failure path below resets via cleanupAfterFailedStart().
      isRunning.set(true)
    }

    try {
      val notification = buildNotification()
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
          )
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }
      } catch (se: SecurityException) {
        Log.e(TAG, "startForeground SecurityException — missing foregroundServiceType?", se)
        cleanupAfterFailedStart()
        MainActivity.notifyLiveBoostState(false)
        stopSelf()
        return
      }

      val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      mediaProjection = projectionManager.getMediaProjection(resultCode, dataIntent)

      if (mediaProjection == null) {
        Log.e(TAG, "MediaProjection could not be initialized")
        cleanupAfterFailedStart()
        stopSelf()
        return
      }

      val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
        .excludeUid(android.os.Process.myUid())
        .build()

      val sampleRate = 48000
      val channelConfigIn = AudioFormat.CHANNEL_IN_STEREO
      val channelConfigOut = AudioFormat.CHANNEL_OUT_STEREO
      val audioEncoding = AudioFormat.ENCODING_PCM_16BIT

      val recordMin = AudioRecord.getMinBufferSize(sampleRate, channelConfigIn, audioEncoding)
      val trackMin = AudioTrack.getMinBufferSize(sampleRate, channelConfigOut, audioEncoding)
      if (recordMin <= 0 || trackMin <= 0) {
        Log.e(TAG, "getMinBufferSize failed: recordMin=$recordMin trackMin=$trackMin")
        cleanupAfterFailedStart()
        stopSelf()
        return
      }
      val recordBufSize = (recordMin * 4).coerceAtLeast(16384)
      val trackBufSize = (trackMin * 4).coerceAtLeast(16384)

      audioRecord = AudioRecord.Builder()
        .setAudioPlaybackCaptureConfig(config)
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(audioEncoding)
            .setSampleRate(sampleRate)
            .setChannelMask(channelConfigIn)
            .build()
        )
        .setBufferSizeInBytes(recordBufSize)
        .build()

      if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
        Log.e(TAG, "AudioRecord not initialized state=${audioRecord?.state}")
        cleanupAfterFailedStart()
        stopSelf()
        return
      }

      audioTrack = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(audioEncoding)
            .setSampleRate(sampleRate)
            .setChannelMask(channelConfigOut)
            .build()
        )
        .setBufferSizeInBytes(trackBufSize)
        .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_NONE)
        .build()

      if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
        Log.e(TAG, "AudioTrack not initialized state=${audioTrack?.state}")
        cleanupAfterFailedStart()
        stopSelf()
        return
      }

      try {
        audioRecord?.startRecording()
      } catch (t: Throwable) {
        Log.e(TAG, "startRecording failed", t)
        cleanupAfterFailedStart()
        stopSelf()
        return
      }
      if (audioRecord?.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        Log.e(TAG, "startRecording did not enter RECORDING state")
        cleanupAfterFailedStart()
        stopSelf()
        return
      }

      try {
        audioTrack?.play()
      } catch (t: Throwable) {
        Log.e(TAG, "AudioTrack play failed", t)
        cleanupAfterFailedStart()
        stopSelf()
        return
      }

      isServiceRunning = true
      MainActivity.notifyLiveBoostState(true)

      val shortsPerRead = recordBufSize / 2
      processingThread = Thread({
        processAudioLoop(shortsPerRead)
      }, "LiveSoundBoosterDSP")
      processingThread?.start()

      Log.i(TAG, "Live Sound Booster started successfully sr=$sampleRate recordBuf=$recordBufSize trackBuf=$trackBufSize")
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to start Live Sound Booster", t)
      cleanupAfterFailedStart()
      MainActivity.notifyLiveBoostState(false)
      stopSelf()
    }
  }

  private fun processAudioLoop(bufferSizeShorts: Int) {
    val buffer = ShortArray(bufferSizeShorts)
    var consecutiveErrors = 0
    while (isRunning.get()) {
      val record = audioRecord ?: break
      val track = audioTrack ?: break

      // Guard: if not recording, backoff
      if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        Log.w(TAG, "not in RECORDING state, sleeping")
        try { Thread.sleep(50) } catch (_: InterruptedException) { break }
        continue
      }
      if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
        try { track.play() } catch (_: Throwable) {}
      }

      val readCount = try {
        record.read(buffer, 0, buffer.size)
      } catch (t: Throwable) {
        Log.e(TAG, "read exception", t)
        AudioRecord.ERROR_INVALID_OPERATION
      }

      when {
        readCount > 0 -> {
          consecutiveErrors = 0
          val gain = currentGain
          for (i in 0 until readCount) {
            val sample = buffer[i] * gain
            buffer[i] = softLimit(sample)
          }
          val written = try { track.write(buffer, 0, readCount) } catch (t: Throwable) {
            Log.e(TAG, "track write exception", t)
            AudioTrack.ERROR_INVALID_OPERATION
          }
          if (written < 0) {
            Log.w(TAG, "AudioTrack write error: $written")
          }
        }
        readCount == AudioRecord.ERROR_INVALID_OPERATION || readCount == AudioRecord.ERROR_BAD_VALUE || readCount == AudioRecord.ERROR_DEAD_OBJECT -> {
          Log.w(TAG, "AudioRecord read error: $readCount consecutive=$consecutiveErrors")
          consecutiveErrors++
          if (consecutiveErrors > 8) {
            Log.e(TAG, "Too many consecutive read errors, stopping loop")
            break
          }
          try { Thread.sleep(20) } catch (_: InterruptedException) { break }
        }
        readCount == 0 -> {
          try { Thread.sleep(5) } catch (_: InterruptedException) { break }
        }
        readCount < 0 -> {
          Log.w(TAG, "AudioRecord read error: $readCount")
          consecutiveErrors++
          if (consecutiveErrors > 12) break
          try { Thread.sleep(10) } catch (_: InterruptedException) { break }
        }
      }
    }
    // If loop exits while still marked running, schedule stop on main thread
    if (isRunning.get()) {
      Log.w(TAG, "processAudioLoop exiting unexpectedly, scheduling stop")
      mainHandler.post { stopBooster() }
    }
  }

  private fun softLimit(sample: Float): Short {
    val norm = sample / 32768.0f
    val absNorm = Math.abs(norm)
    val knee = 0.75f
    val headroom = 0.25f

    val limited = if (absNorm <= knee) {
      norm
    } else {
      val sign = if (norm >= 0.0f) 1.0f else -1.0f
      val over = absNorm - knee
      sign * (knee + headroom * Math.tanh((over / headroom).toDouble()).toFloat())
    }
    val scaled = (limited * 32767.0f).toInt()
    return scaled.coerceIn(-32768, 32767).toShort()
  }

  private fun stopBooster() {
    val wasRunning = isServiceRunning || isRunning.get()
    isRunning.set(false)
    isServiceRunning = false

    try {
      processingThread?.interrupt()
      try { processingThread?.join(800) } catch (_: Throwable) {}
      processingThread = null

      try {
        if (audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) audioRecord?.stop()
      } catch (_: Throwable) {}
      try { audioRecord?.release() } catch (_: Throwable) {}
      audioRecord = null

      try {
        if (audioTrack?.playState == AudioTrack.PLAYSTATE_PLAYING) audioTrack?.stop()
      } catch (_: Throwable) {}
      try { audioTrack?.release() } catch (_: Throwable) {}
      audioTrack = null

      try { mediaProjection?.stop() } catch (_: Throwable) {}
      mediaProjection = null
    } catch (t: Throwable) {
      Log.w(TAG, "Error cleaning up live booster resources", t)
    }

    if (wasRunning) {
      MainActivity.notifyLiveBoostState(false)
    }

    try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Throwable) {}
    stopSelf()
    Log.i(TAG, "Live Sound Booster stopped")
  }

  override fun onDestroy() {
    stopBooster()
    super.onDestroy()
  }
}
