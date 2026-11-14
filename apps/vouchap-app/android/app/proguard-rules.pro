# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Expo Modules / Sweet API Records (R8 fullMode otherwise breaks JS→Kotlin cast:
# "cannot be cast to type …OpenBrowserOptions (received ReadableNativeMap)" + NPE)
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keep class expo.modules.** { *; }
-keepclassmembers class expo.modules.** { *; }
-keep class * implements expo.modules.kotlin.records.Record { *; }
-keepclassmembers class * implements expo.modules.kotlin.records.Record {
  <init>(...);
  *;
}
-keepclassmembers class * {
  @expo.modules.kotlin.records.Field *;
}

# Add any project specific keep options here:
