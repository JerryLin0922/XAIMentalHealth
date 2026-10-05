# MoodHub WebView 壳不混淆（R8 关闭）。若开启 minify，请保留 JS 桥相关成员：
# -keepclassmembers class com.moodhub.app.** { @android.webkit.JavascriptInterface <methods>; }
