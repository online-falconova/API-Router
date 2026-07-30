# Keep JavaScript interface methods (none used currently, but safe for future).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# WebView with JS enabled is common; keep standard WebView members.
-keep class android.webkit.** { *; }
