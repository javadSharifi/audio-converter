package com.audioconverter.app

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

  interface PlaybackEventListener {
    fun onPlaybackStateChanged(stateJson: String)
    fun onTrackTransition(trackJson: String)
    fun onIsPlayingChanged(isPlaying: Boolean)
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    Log.i(TAG, "Creating PlaybackService with Jetpack Media3")

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
          val trackJson = mediaItemToTrackJson(mediaItem)
          eventListener?.onTrackTransition(trackJson)
          broadcastStateUpdate()
        }

        override fun onPlayerError(error: PlaybackException) {
          Log.e(TAG, "Player error: ${error.errorCodeName} - ${error.message}", error)
          broadcastStateUpdate()
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
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to initialize MediaSessionService", t)
    }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
    return mediaSession
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val pl = player
    if (pl == null || !pl.playWhenReady || pl.mediaItemCount == 0) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    Log.i(TAG, "Destroying PlaybackService")
    if (instance === this) {
      instance = null
    }
    mediaSession?.run {
      player.release()
      release()
      mediaSession = null
    }
    player = null
    super.onDestroy()
  }

  private fun broadcastStateUpdate() {
    val state = getCurrentStateJson()
    eventListener?.onPlaybackStateChanged(state)
  }

  @Keep
  companion object {
    private const val TAG = "PlaybackService"

    @Volatile
    var instance: PlaybackService? = null

    @Volatile
    var eventListener: PlaybackEventListener? = null

    private val mainHandler = Handler(Looper.getMainLooper())

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
      var uriStr = trackObj.optString("uri", "")
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

      if (coverUrl.isNotBlank()) {
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
     */
    @JvmStatic
    fun playTrack(context: Context, trackJson: String, playlistJson: String?, startIndex: Int): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        val player = service.player ?: return@runOnService "PLAYER_NULL"
        try {
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

    @JvmStatic
    fun pause(context: Context): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.pause()
        "OK"
      }
    }

    @JvmStatic
    fun resume(context: Context): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.play()
        "OK"
      }
    }

    @JvmStatic
    fun seekTo(context: Context, positionMs: Long): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.seekTo(positionMs)
        "OK"
      }
    }

    @JvmStatic
    fun next(context: Context): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.seekToNextMediaItem()
        "OK"
      }
    }

    @JvmStatic
    fun previous(context: Context): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.seekToPreviousMediaItem()
        "OK"
      }
    }

    @JvmStatic
    fun setRepeatMode(context: Context, mode: String): String {
      ensureServiceStarted(context)
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
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.shuffleModeEnabled = enabled
        "OK"
      }
    }

    @JvmStatic
    fun setPlaybackSpeed(context: Context, speed: Float): String {
      ensureServiceStarted(context)
      return runOnService { service ->
        service.player?.setPlaybackSpeed(speed.coerceIn(0.25f, 4.0f))
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
      val service = instance ?: return JSONObject().apply {
        put("isPlaying", false)
        put("currentTimeMs", 0)
        put("durationMs", 0)
        put("currentIndex", -1)
        put("currentTrack", JSONObject.NULL)
      }.toString()

      val player = service.player ?: return "{}"

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
          put("currentTrack", currentTrackJson)
        }
        json.toString()
      } catch (t: Throwable) {
        Log.e(TAG, "getCurrentStateJson error", t)
        "{}"
      }
    }

    private fun runOnService(action: (PlaybackService) -> String): String {
      val service = instance
      if (service == null) {
        Log.w(TAG, "PlaybackService instance is null; scheduling action on main looper")
        return "SERVICE_NOT_READY"
      }
      return try {
        if (Looper.myLooper() == Looper.getMainLooper()) {
          action(service)
        } else {
          var result = "OK"
          mainHandler.post {
            try {
              result = action(service)
            } catch (t: Throwable) {
              Log.e(TAG, "Error running action on main looper", t)
            }
          }
          result
        }
      } catch (t: Throwable) {
        Log.e(TAG, "runOnService exception", t)
        t.message ?: "ERROR"
      }
    }
  }
}
