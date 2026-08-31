-keep class com.audioconverter.app.MainActivity {
    public static <methods>;
    public <methods>;
    *;
}
-keep class com.audioconverter.app.MainActivity$Companion {
    public <methods>;
    *;
}
-keepclassmembers class com.audioconverter.app.MainActivity {
    public static <methods>;
    *;
}
-keepclassmembers class com.audioconverter.app.MainActivity$Companion {
    public <methods>;
    *;
}
-keep class com.audioconverter.app.LiveSoundBoosterService {
    *;
}
-keep class com.audioconverter.app.LiveSoundBoosterService$Companion {
    *;
}
-keepclasseswithmembers class * {
    native <methods>;
}
