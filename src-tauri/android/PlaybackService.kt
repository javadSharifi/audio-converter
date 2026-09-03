package com.audioconverter.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.Keep
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Android Jetpack Media3 PlaybackService for high-fidelity, system-integrated
 * background audio playback, Lock Screen controls, Media Notifications,
 * Bluetooth headsets, and Audio Focus handling.
 */
@Keep
class PlaybackService : MediaSessionService() {

  private var mediaSession: MediaSession? = null
  private var player: ExoPlayer? = null

  // Real-time loudness boost (Namida pattern): Android LoudnessEnhancer bound
  // to the ExoPlayer audio session. ExoPlayer.volume caps at 1.0, so anything
  // above 100% rides this effect instead of being silently clamped.
  private var loudnessEnhancer: android.media.audiofx.LoudnessEnhancer? = null
  private var boosterGainDb: Float = 0f
  private var boosterUnsupported: Boolean = false
  // Media3 1.5 exposes the output session ONLY through the
  // onAudioSessionIdChanged callback (there is no readable
  // player.audioSessionId property) — track it here for the enhancer.
  private var currentAudioSessionId: Int = 0

  interface PlaybackEventListener {
    fun onPlaybackStateChanged(stateJson: String)
    fun onTrackTransition(trackJson: String)
    fun onIsPlayingChanged(isPlaying: Boolean)
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    Log.i(TAG, "Creating PlaybackService with Jetpack Media3")

    // Rhythm pattern: explicit notification provider + channel + early
    // foreground promotion. MediaSessionService auto-promotes on playback,
    // but when started via startForegroundService() Android requires
    // startForeground() within ~5s or the process is killed (the classic
    // "playback stops after ~5s / in background" failure). Promote early
    // with a placeholder notification; Media3 replaces it once playing.
    try {
      setMediaNotificationProvider(
        androidx.media3.session.DefaultMediaNotificationProvider(this).apply {
          setSmallIcon(R.drawable.ic_notification)
        }
      )
    } catch (t: Throwable) {
      Log.w(TAG, "Could not set custom notification provider", t)
    }
    createNotificationChannel()
    startForegroundWithPlaceholder()

    try {
      val audioAttributes = AudioAttributes.Builder()
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .setUsage(C.USAGE_MEDIA)
        .build()

      player = ExoPlayer.Builder(this)
        .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_LOCAL)
        .build()

      player?.addListener(object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
          Log.d(TAG, "onIsPlayingChanged: $isPlaying")
          eventListener?.onIsPlayingChanged(isPlaying)
          broadcastStateUpdate()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
          Log.d(TAG, "onPlaybackStateChanged: $playbackState")
          broadcastStateUpdate()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
          Log.d(TAG, "onMediaItemTransition: ${mediaItem?.mediaId}, reason: $reason")
          // A new item means any previous fatal error no longer describes
          // the current track (Rhythm clears per-track error UI on transition).
          lastErrorCode = null
          lastErrorMessage = null
          val trackJson = mediaItemToTrackJson(mediaItem)
          eventListener?.onTrackTransition(trackJson)
          broadcastStateUpdate()
        }

        override fun onPlayerError(error: PlaybackException) {
          Log.e(TAG, "Player error: ${error.errorCodeName} - ${error.message}", error)
          // Remember the failure so the UI/poll bridge can surface WHY the
          // player stalled instead of showing a silent seekbar freeze.
          // Cleared on the next successful transition or play() call.
          lastErrorCode = error.errorCodeName ?: "PLAYBACK_ERROR"
          lastErrorMessage = error.message
          broadcastStateUpdate()
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) {
          // The output session can change across plays; the enhancer is bound
          // to a session id, so re-attach (reusing the stored gain) instead
          // of boosting into a dead session.
          try {
            currentAudioSessionId = audioSessionId
            ensureBoosterAttached()
          } catch (t: Throwable) {
            Log.w(TAG, "Booster re-attach failed", t)
          }
        }
      })

      val sessionActivityIntent = Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }

      val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }

      val sessionActivityPendingIntent = PendingIntent.getActivity(
        this,
        0,
        sessionActivityIntent,
        pendingIntentFlags
      )

      val builder = MediaSession.Builder(this, player!!)
        .setSessionActivity(sessionActivityPendingIntent)

      mediaSession = builder.build()
      Log.i(TAG, "MediaSession created successfully")
      drainPendingPlay()
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to initialize MediaSessionService", t)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Delegate to MediaSessionService so media-button / controller intents
    // keep working; framework decides stickiness. Rhythm returns the super
    // result here as well (START_NOT_STICKY only for its own early-returns).
    // Never let an exception escape a Service lifecycle callback — that is an
    // instant "keeps stopping" crash with no recovery.
    return try {
      super.onStartCommand(intent, flags, startId)
    } catch (t: Throwable) {
      Log.e(TAG, "onStartCommand failed", t)
      android.app.Service.START_NOT_STICKY
    }
  }

  @OptIn(UnstableApi::class)
  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
    // Let Media3 drive notification <-> foreground transitions (notification,
    // lock screen, Bluetooth all follow the session). Override kept explicit
    // so future custom buttons/channel tweaks have a single hook (Rhythm
    // keeps the same override for its icon guarantee).
    try {
      super.onUpdateNotification(session, startInForegroundRequired)
    } catch (t: Throwable) {
      Log.e(TAG, "onUpdateNotification failed", t)
    }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
    return try {
      mediaSession
    } catch (t: Throwable) {
      Log.e(TAG, "onGetSession failed", t)
      null
    }
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Rhythm pattern: keep the service alive while actually playing so
    // swipe-away does not kill background audio; stop only when idle.
    // Media3 keeps the foreground notification while playing; stopSelf()
    // when idle lets the system reclaim us cleanly.
    try {
      val pl = player
      if (pl == null || !pl.playWhenReady || pl.mediaItemCount == 0) {
        try {
          stopSelf()
        } catch (t: Throwable) {
          Log.w(TAG, "stopSelf failed in onTaskRemoved", t)
        }
      } else {
        Log.i(TAG, "onTaskRemoved: continuing background playback")
      }
    } catch (t: Throwable) {
      Log.e(TAG, "onTaskRemoved failed", t)
    }
    try {
      super.onTaskRemoved(rootIntent)
    } catch (t: Throwable) {
      Log.e(TAG, "super.onTaskRemoved failed", t)
    }
  }

  override fun onDestroy() {
    Log.i(TAG, "Destroying PlaybackService")
    try {
      if (instance === this) {
        instance = null
      }
    } catch (_: Throwable) {}
    try {
      mediaSession?.run {
        try {
          player.release()
        } catch (t: Throwable) {
          Log.w(TAG, "player.release failed in onDestroy", t)
        }
        try {
          release()
        } catch (t: Throwable) {
          Log.w(TAG, "session.release failed in onDestroy", t)
        }
        mediaSession = null
      }
    } catch (t: Throwable) {
      Log.e(TAG, "mediaSession release failed in onDestroy", t)
    }
    player = null
    pendingPlay = null
    releaseBooster()
    try {
      super.onDestroy()
    } catch (t: Throwable) {
      Log.e(TAG, "super.onDestroy failed", t)
    }
  }

  /**
   * Store the desired boost and (re)attach the effect. Safe to call any time:
   * before the player exists, before the audio session is assigned, or on an
   * unsupported device — every one of those is a no-op (with the gain kept
   * for the next valid session) rather than a crash.
   */
  private fun applyBoosterGain(gainDb: Float) {
    boosterGainDb = gainDb.coerceIn(0f, MAX_BOOSTER_GAIN_DB)
    ensureBoosterAttached()
  }

  private fun ensureBoosterAttached() {
    if (boosterUnsupported) return
    // No boost wanted and no effect allocated: don't grab an audio effect
    // for nothing (disabling an existing one still goes through below).
    if (boosterGainDb <= 0.01f && loudnessEnhancer == null) return
    if (player == null) return
    // Session not assigned yet (player fresh / nothing prepared): the
    // onAudioSessionIdChanged callback retries once it becomes valid.
    val sessionId = currentAudioSessionId
    if (sessionId == 0 || sessionId == android.media.AudioManager.ERROR) return
    val current = loudnessEnhancer
    if (current != null) {
      val boundSession = try {
        current.audioSessionId
      } catch (_: Throwable) {
        -1
      }
      if (boundSession == sessionId) {
        applyBoosterTarget(current)
        return
      }
      try {
        current.release()
      } catch (_: Throwable) {}
      loudnessEnhancer = null
    }
    try {
      val enhancer = android.media.audiofx.LoudnessEnhancer(sessionId)
      loudnessEnhancer = enhancer
      applyBoosterTarget(enhancer)
    } catch (t: Throwable) {
      // Device has no LoudnessEnhancer for this session: stay quiet and keep
      // plain volume behavior instead of crashing playback.
      Log.w(TAG, "LoudnessEnhancer not supported on this device", t)
      boosterUnsupported = true
      loudnessEnhancer = null
    }
  }

  private fun applyBoosterTarget(enhancer: android.media.audiofx.LoudnessEnhancer) {
    try {
      // Frontend sends dB; the effect takes millibels (Namida mapping).
      enhancer.setTargetGain(Math.round(boosterGainDb * 100f))
      enhancer.enabled = boosterGainDb > 0.01f
    } catch (t: Throwable) {
      // Out-of-range gain on strict OEMs: fall back to unboosted output.
      Log.w(TAG, "setTargetGain failed, disabling booster", t)
      try {
        enhancer.enabled = false
      } catch (_: Throwable) {}
    }
  }

  private fun releaseBooster() {
    try {
      loudnessEnhancer?.release()
    } catch (_: Throwable) {}
    loudnessEnhancer = null
  }

  private fun broadcastStateUpdate() {
    val state = getCurrentStateJson()
    // Listener callbacks run on the main looper, so this write is safe and
    // keeps the fallback snapshot fresh for off-thread readers.
    lastKnownStateJson = state
    eventListener?.onPlaybackStateChanged(state)
    // Rhythm pattern: push, don't just wait to be polled. The WebView
    // setInterval timer is throttled when the app is backgrounded, so a
    // poll-only bridge delivers track changes late. Dispatch a CustomEvent
    // on the same channel style as MainActivity.notifyUrisToFrontend; the
    // React engine subscribes once and shares the parser with the poll
    // fallback (poll stays as safety net at a lower rate).
    try {
      MainActivity.dispatchPlayerState(state)
    } catch (t: Throwable) {
      Log.w(TAG, "dispatchPlayerState push failed", t)
    }
  }

  /**
   * Reads the live player state. MUST run on the main (application) looper —
   * Media3 1.5+ throws IllegalStateException otherwise. Callers on other
   * threads must go through getCurrentStateJson(), which marshals here.
   */
  private fun snapshotStateLocked(): String {
    val player = player ?: return "{}"
    return try {
      val currentItem = player.currentMediaItem
      val currentTrackJson = if (currentItem != null) {
        JSONObject(mediaItemToTrackJson(currentItem))
      } else {
        JSONObject.NULL
      }

      val json = JSONObject().apply {
        put("isPlaying", player.isPlaying)
        put("currentTimeMs", player.currentPosition.coerceAtLeast(0L))
        val dur = player.duration
        put("durationMs", if (dur != C.TIME_UNSET) dur.coerceAtLeast(0L) else 0L)
        put("currentIndex", player.currentMediaItemIndex)
        put("repeatMode", when (player.repeatMode) {
          Player.REPEAT_MODE_ONE -> "one"
          Player.REPEAT_MODE_ALL -> "all"
          else -> "off"
        })
        put("shuffleMode", player.shuffleModeEnabled)
        put("playbackRate", player.playbackParameters.speed)
        put("volume", player.volume)
        put("playbackState", player.playbackState)
        val errCode = lastErrorCode
        val errMsg = lastErrorMessage
        if (errCode != null) {
          put("errorCode", errCode)
          put("errorMessage", errMsg ?: JSONObject.NULL)
        }
        put("currentTrack", currentTrackJson)
      }
      val rendered = json.toString()
      lastKnownStateJson = rendered
      rendered
    } catch (t: Throwable) {
      Log.e(TAG, "snapshotStateLocked error", t)
      lastKnownStateJson ?: "{}"
    }
  }

  private fun drainPendingPlay() {
    val pending = pendingPlay ?: return
    pendingPlay = null
    Log.i(TAG, "Draining queued cold-start play request (index=${pending.startIndex})")
    try {
      // Reuse the same path as a normal play so queue/metadata handling
      // cannot drift between cold-start and warm-start.
      mainHandler.post {
        try {
          instance?.let { service ->
            val player = service.player
            if (player == null) {
              Log.w(TAG, "Player still null while draining pending play")
              return@post
            }
            lastErrorCode = null
            lastErrorMessage = null
            val mediaItems = ArrayList<MediaItem>()
            if (!pending.playlistJson.isNullOrBlank()) {
              val arr = JSONArray(pending.playlistJson)
              for (i in 0 until arr.length()) {
                mediaItems.add(buildMediaItem(arr.getJSONObject(i)))
              }
            }
            if (mediaItems.isEmpty() && pending.trackJson.isNotBlank()) {
              mediaItems.add(buildMediaItem(JSONObject(pending.trackJson)))
            }
            if (mediaItems.isEmpty()) return@post
            val safeIndex = pending.startIndex.coerceIn(0, mediaItems.size - 1)
            player.setMediaItems(mediaItems, safeIndex, 0L)
            player.prepare()
            player.play()
          }
        } catch (t: Throwable) {
          Log.e(TAG, "Drain pending play failed", t)
        }
      }
    } catch (t: Throwable) {
      Log.e(TAG, "Could not schedule pending play drain", t)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val channel = NotificationChannel(
        CHANNEL_ID,
        getString(R.string.media3_notification_channel_name),
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = getString(R.string.media3_notification_channel_description)
        setShowBadge(false)
      }
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(channel)
    } catch (t: Throwable) {
      Log.w(TAG, "createNotificationChannel failed", t)
    }
  }

  private fun startForegroundWithPlaceholder() {
    val notification = try {
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(getString(R.string.app_name))
        .setContentText(getString(R.string.service_starting))
        .setSmallIcon(R.drawable.ic_notification)
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()
    } catch (t: Throwable) {
      Log.w(TAG, "Placeholder notification build failed", t)
      return
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      Log.d(TAG, "Early foreground promotion posted")
    } catch (t: Throwable) {
      // Background-start restriction (ForegroundServiceStartNotAllowedException
      // on S+): Media3 will promote once playback actually starts from a
      // foreground context. Keep a plain notification as fallback.
      Log.w(TAG, "Early startForeground blocked, using fallback notification", t)
      try {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, notification)
      } catch (_: Throwable) {}
    }
  }

  @Keep
  companion object {
    private const val TAG = "PlaybackService"
    private const val NOTIFICATION_ID = 1001
    private const val CHANNEL_ID = "RhythmMediaPlayback"
    // 400% UI boost ~= +12 dB (20*log10(4)). Defensive ceiling: strict OEMs
    // throw on larger target gains, and applyBoosterTarget degrades to off.
    private const val MAX_BOOSTER_GAIN_DB = 12f

    @Volatile
    var instance: PlaybackService? = null

    @Volatile
    var eventListener: PlaybackEventListener? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    // Cold-start race: JNI playTrack() can arrive before onCreate() sets
    // `instance` (service start is async). Dropping it returns
    // SERVICE_NOT_READY and the first tap "does nothing". Queue it and drain
    // once the session exists (Rhythm avoids this via MediaController
    // async-connect queuing; we emulate the same guarantee explicitly).
    private data class PendingPlay(
      val trackJson: String,
      val playlistJson: String?,
      val startIndex: Int
    )

    @Volatile
    private var pendingPlay: PendingPlay? = null

    @Volatile
    private var lastErrorCode: String? = null

    @Volatile
    private var lastErrorMessage: String? = null

    // Last good snapshot (written on the main thread). getCurrentStateJson()
    // is called from the WebView JavaBridge thread where Media3 1.5+ throws
    // IllegalStateException on direct Player access — the snapshot keeps the
    // poll/push bridge alive even if the main-looper round-trip fails.
    @Volatile
    private var lastKnownStateJson: String? = null

    private fun idleStateJson(): String = JSONObject().apply {
      put("isPlaying", false)
      put("currentTimeMs", 0)
      put("durationMs", 0)
      put("currentIndex", -1)
      put("currentTrack", JSONObject.NULL)
    }.toString()

    private fun ensureServiceStarted(context: Context) {
      if (instance == null) {
        try {
          val intent = Intent(context, PlaybackService::class.java)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, intent)
          } else {
            context.startService(intent)
          }
        } catch (t: Throwable) {
          Log.w(TAG, "Could not start PlaybackService", t)
        }
      }
    }

    private fun buildMediaItem(trackObj: JSONObject): MediaItem {
      val id = trackObj.optString("id", "")
      // Raw uri BEFORE the file:// fallback below: the artwork cache key must
      // use the exact same string the frontend sent to getEmbeddedArtwork
      // (track.uri || track.path), otherwise the exists() check always misses.
      val rawUri = trackObj.optString("uri", "")
      var uriStr = rawUri
      val path = trackObj.optString("path", "")
      val title = trackObj.optString("title", trackObj.optString("name", "Unknown Title"))
      val artist = trackObj.optString("artist", "Unknown Artist")
      val album = trackObj.optString("album", "Unknown Album")
      val coverUrl = trackObj.optString("coverUrl", "")

      // Fallback to local file path if URI is empty
      if (uriStr.isBlank() && path.isNotBlank()) {
        uriStr = if (path.startsWith("file://")) path else "file://$path"
      }

      val mediaUri = Uri.parse(uriStr)

      val metadataBuilder = MediaMetadata.Builder()
        .setTitle(title)
        .setArtist(artist)
        .setAlbumTitle(album)
        .setDisplayTitle(title)

      // Prefer the embedded-artwork cache file (populated lazily by
      // MainActivity.getEmbeddedArtwork): a readable file:// entry always
      // loads in the notification/lock-screen player, while the legacy
      // MediaStore `albumart` content URI is often dead on Android 10+.
      // Purely a fast exists() check — no extraction on the playback path.
      var artworkSet = false
      try {
        val cacheKey = rawUri.ifBlank { path }.ifBlank { id }
        val cached = MainActivity.artworkCacheFileFor(cacheKey)
        if (cached != null && cached.exists() && cached.length() > 0) {
          metadataBuilder.setArtworkUri(Uri.fromFile(cached))
          artworkSet = true
        }
      } catch (_: Throwable) {}

      if (!artworkSet && coverUrl.isNotBlank()) {
        try {
          metadataBuilder.setArtworkUri(Uri.parse(coverUrl))
        } catch (_: Throwable) {}
      }

      val extras = android.os.Bundle().apply {
        putString("track_id", id)
        putString("raw_uri", uriStr)
        putString("raw_path", path)
        putString("cover_url", coverUrl)
      }

      metadataBuilder.setExtras(extras)

      return MediaItem.Builder()
        .setMediaId(id.ifBlank { uriStr })
        .setUri(mediaUri)
        .setMediaMetadata(metadataBuilder.build())
        .build()
    }

    private fun mediaItemToTrackJson(mediaItem: MediaItem?): String {
      if (mediaItem == null) return "{}"
      val meta = mediaItem.mediaMetadata
      val extras = meta.extras
      val id = extras?.getString("track_id") ?: mediaItem.mediaId
      val uri = extras?.getString("raw_uri") ?: mediaItem.requestMetadata.mediaUri?.toString() ?: ""
      val path = extras?.getString("raw_path") ?: ""
      val coverUrl = extras?.getString("cover_url") ?: meta.artworkUri?.toString() ?: ""

      val json = JSONObject().apply {
        put("id", id)
        put("uri", uri)
        put("path", if (path.isNotBlank()) path else JSONObject.NULL)
        put("title", meta.title?.toString() ?: "Unknown Title")
        put("artist", meta.artist?.toString() ?: "Unknown Artist")
        put("album", meta.albumTitle?.toString() ?: "Unknown Album")
        put("coverUrl", if (coverUrl.isNotBlank()) coverUrl else JSONObject.NULL)
      }
      return json.toString()
    }

    /**
     * Play a single track or queue of tracks starting at startIndex.
     * Cold-start safe: if the service instance is not yet alive the request
     * is queued and drained in onCreate() instead of being dropped as
     * SERVICE_NOT_READY (the previous "first tap does nothing" bug).
     */
    @JvmStatic
    fun playTrack(context: Context, trackJson: String, playlistJson: String?, startIndex: Int): String {
      ensureServiceStarted(context)
      if (instance == null) {
        pendingPlay = PendingPlay(trackJson, playlistJson, startIndex)
        Log.i(TAG, "Service not ready; queued play request (index=$startIndex)")
        return "PENDING"
      }
      return runOnService { service ->
        val player = service.player ?: return@runOnService "PLAYER_NULL"
        try {
          // A fresh explicit play supersedes any previous fatal error UI.
          lastErrorCode = null
          lastErrorMessage = null
          val mediaItems = ArrayList<MediaItem>()

          if (!playlistJson.isNullOrBlank()) {
            val arr = JSONArray(playlistJson)
            for (i in 0 until arr.length()) {
              val itemObj = arr.getJSONObject(i)
              mediaItems.add(buildMediaItem(itemObj))
            }
          }

          if (mediaItems.isEmpty() && trackJson.isNotBlank()) {
            val trackObj = JSONObject(trackJson)
            mediaItems.add(buildMediaItem(trackObj))
          }

          if (mediaItems.isEmpty()) {
            return@runOnService "NO_TRACKS"
          }

          val safeIndex = startIndex.coerceIn(0, mediaItems.size - 1)

          player.setMediaItems(mediaItems, safeIndex, 0L)
          player.prepare()
          player.play()
          "OK"
        } catch (e: Throwable) {
          Log.e(TAG, "playTrack error", e)
          e.message ?: "UNKNOWN_ERROR"
        }
      }
    }

    // NOTE: only playTrack() calls ensureServiceStarted(). Control commands
    // (pause/resume/seek/next/...) must NEVER restart the service: every
    // startForegroundService() call re-arms the system's "call
    // startForeground() in time" watchdog, and re-starting a live/paused
    // service is exactly what produced ForegroundServiceDidNotStartInTime
    // crashes. If the service is dead there is nothing to pause — the poll
    // bridge reports idle and the next playTrack() starts it fresh.
    @JvmStatic
    fun pause(context: Context): String {
      return runOnService { service ->
        service.player?.pause()
        "OK"
      }
    }

    @JvmStatic
    fun resume(context: Context): String {
      return runOnService { service ->
        service.player?.play()
        "OK"
      }
    }

    @JvmStatic
    fun seekTo(context: Context, positionMs: Long): String {
      return runOnService { service ->
        service.player?.seekTo(positionMs)
        "OK"
      }
    }

    @JvmStatic
    fun next(context: Context): String {
      return runOnService { service ->
        service.player?.seekToNextMediaItem()
        "OK"
      }
    }

    @JvmStatic
    fun previous(context: Context): String {
      return runOnService { service ->
        service.player?.seekToPreviousMediaItem()
        "OK"
      }
    }

    @JvmStatic
    fun setRepeatMode(context: Context, mode: String): String {
      return runOnService { service ->
        val player = service.player ?: return@runOnService "PLAYER_NULL"
        when (mode.lowercase()) {
          "one", "track" -> player.repeatMode = Player.REPEAT_MODE_ONE
          "all", "playlist" -> player.repeatMode = Player.REPEAT_MODE_ALL
          else -> player.repeatMode = Player.REPEAT_MODE_OFF
        }
        "OK"
      }
    }

    @JvmStatic
    fun setShuffleMode(context: Context, enabled: Boolean): String {
      return runOnService { service ->
        service.player?.shuffleModeEnabled = enabled
        "OK"
      }
    }

    @JvmStatic
    fun setPlaybackSpeed(context: Context, speed: Float): String {
      return runOnService { service ->
        service.player?.setPlaybackSpeed(speed.coerceIn(0.25f, 4.0f))
        "OK"
      }
    }

    @JvmStatic
    fun setVolume(context: Context, volume: Float): String {
      return runOnService { service ->
        // 0.0..1.0 device-volume fraction for the ExoPlayer instance.
        // True boost above 100% rides the LoudnessEnhancer (setBoosterGain),
        // never this fraction.
        service.player?.volume = volume.coerceIn(0f, 1f)
        "OK"
      }
    }

    @JvmStatic
    fun setBoosterGain(context: Context, gainDb: Float): String {
      return runOnService { service ->
        service.applyBoosterGain(gainDb)
        "OK"
      }
    }

    @JvmStatic
    fun stop(context: Context): String {
      return runOnService { service ->
        service.player?.stop()
        service.player?.clearMediaItems()
        "OK"
      }
    }

    @JvmStatic
    fun getCurrentStateJson(): String {
      val service = instance ?: return lastKnownStateJson ?: idleStateJson()
      // Media3 1.5+ throws IllegalStateException when the Player is touched
      // off the application looper ("Player is accessed on the wrong thread").
      // JNI state polls arrive on the WebView JavaBridge thread, so marshal
      // to main exactly like runOnService() does. Never throw out of a JNI
      // bridge — fall back to the last good snapshot instead.
      if (Looper.myLooper() == Looper.getMainLooper()) {
        return try {
          service.snapshotStateLocked()
        } catch (t: Throwable) {
          Log.e(TAG, "snapshotStateLocked error", t)
          lastKnownStateJson ?: "{}"
        }
      }
      var result: String? = null
      val latch = java.util.concurrent.CountDownLatch(1)
      try {
        mainHandler.post {
          try {
            result = service.snapshotStateLocked()
          } catch (t: Throwable) {
            Log.w(TAG, "snapshot on main looper failed", t)
          } finally {
            latch.countDown()
          }
        }
      } catch (t: Throwable) {
        Log.w(TAG, "getCurrentStateJson post failed", t)
        return lastKnownStateJson ?: "{}"
      }
      return try {
        if (latch.await(2, java.util.concurrent.TimeUnit.SECONDS)) {
          result ?: (lastKnownStateJson ?: "{}")
        } else {
          Log.w(TAG, "getCurrentStateJson timed out waiting for main looper")
          lastKnownStateJson ?: "{}"
        }
      } catch (ie: InterruptedException) {
        Thread.currentThread().interrupt()
        lastKnownStateJson ?: "{}"
      }
    }

    private fun runOnService(action: (PlaybackService) -> String): String {
      val service = instance
      if (service == null) {
        Log.w(TAG, "PlaybackService instance is null for control action")
        return "SERVICE_NOT_READY"
      }
      return try {
        if (Looper.myLooper() == Looper.getMainLooper()) {
          action(service)
        } else {
          // Tauri JNI calls arrive on Rust worker threads. The previous code
          // posted async and returned "OK" before the action ran (fire-and-
          // forget). Block briefly so pause/seek/next actually complete
          // before the IPC returns — ExoPlayer itself is thread-safe, but all
          // our player/session access stays on the main looper by design.
          var result = "OK"
          var failure: Throwable? = null
          val latch = java.util.concurrent.CountDownLatch(1)
          mainHandler.post {
            try {
              result = action(service)
            } catch (t: Throwable) {
              failure = t
              Log.e(TAG, "Error running action on main looper", t)
            } finally {
              latch.countDown()
            }
          }
          try {
            if (!latch.await(4, java.util.concurrent.TimeUnit.SECONDS)) {
              Log.w(TAG, "runOnService timed out waiting for main looper")
              return "TIMEOUT"
            }
          } catch (ie: InterruptedException) {
            Thread.currentThread().interrupt()
            return "INTERRUPTED"
          }
          failure?.let { throw it }
          result
        }
      } catch (t: Throwable) {
        Log.e(TAG, "runOnService exception", t)
        t.message ?: "ERROR"
      }
    }
  }
}
