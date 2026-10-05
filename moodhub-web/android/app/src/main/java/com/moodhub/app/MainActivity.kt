package com.moodhub.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * MoodHub Android 壳。
 *
 * 不改一行业务代码：把 moodhub-web 整个目录原样放进 assets/www，
 * 通过 WebViewAssetLoader 映射为 https://appassets.androidplatform.net，
 * 页面因此拥有真正的「安全上下文」——localStorage 持久、crypto.subtle 可用，
 * 行为与线上浏览器完全一致。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = fileChooserCallback
            fileChooserCallback = null
            cb?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        webView.id = View.generateViewId()
        setContentView(webView)

        // targetSdk 35 起强制 edge-to-edge：把内容从系统栏下推出来
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_DOMAIN)
            .addPathHandler(
                "/assets/",
                WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage / sessionStorage，MoodHub 的数据都在这
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false           // 只走 appassets 域，禁掉 file://
            allowContentAccess = false
            textZoom = 100                    // 忽略系统字体缩放，保持响应式断点不乱
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // 应用内资源一律放行；外部链接交给系统浏览器，避免把用户带出应用
                return if (url.host == APP_DOMAIN) {
                    false
                } else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // 「第三方数据导入 / 问答上传」都依赖 <input type="file">
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    fileChooserLauncher.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileChooserCallback = null
                    false
                }
            }

            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                dialog(message, null, result)
                return true
            }

            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                dialog(message, null, result)
                return true
            }

            override fun onJsPrompt(
                view: WebView,
                url: String,
                message: String,
                defaultValue: String,
                result: JsResult
            ): Boolean {
                dialog(message, defaultValue, result)
                return true
            }

            // 不做任何定位采集，直接拒绝
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: android.webkit.GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }
        }

        // 「设置 → 导出 JSON 备份」用的是 Blob + a.download
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            when {
                url.startsWith("blob:") || url.startsWith("data:") -> saveBlobAsFile(url, contentDisposition, mimeType)
                url.startsWith("http") -> enqueueDownloadManager(url, contentDisposition, mimeType)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.apply {
            loadUrl("about:blank")
            clearHistory()
            (parent as? android.view.ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    private fun dialog(message: String, inputValue: String?, result: JsResult) {
        val builder = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_DayNight)
            .setTitle(getString(R.string.app_name))
            .setMessage(message)
            .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
            .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
            .setOnCancelListener { result.cancel() }

        if (inputValue != null) {
            val input = EditText(this)
            input.setText(inputValue)
            builder.setView(input).setPositiveButton(android.R.string.ok) { _, _ ->
                result.confirm(input.text.toString())
            }
        }
        builder.show()
    }

    private fun enqueueDownloadManager(url: String, contentDisposition: String?, mimeType: String?) {
        val name = guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setMimeType(mimeType)
            setTitle(name)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        }
        runCatching {
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "已开始下载 $name", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * blob:/data: 无法直接交给系统下载器，这里用页面内 JS 把内容转成 base64 取回来，
     * 再写入系统「下载」目录（API 29+ 走 MediaStore，无需任何存储权限）。
     */
    private fun saveBlobAsFile(url: String, contentDisposition: String?, mimeType: String?) {
        val js = """
            (function(){
              return fetch(${jsString(url)}).then(function(r){ return r.blob(); }).then(function(b){
                return new Promise(function(res){
                  var fr = new FileReader();
                  fr.onload = function(){ res(String(fr.result).split(',')[1] || ''); };
                  fr.onerror = function(){ res(''); };
                  fr.readAsDataURL(b);
                });
              });
            })()
        """.trimIndent()

        webView.evaluateJavascript(js) { raw ->
            val b64 = raw?.trim()?.removeSurrounding("\"")?.replace("\\/", "/").orEmpty()
            if (b64.isEmpty()) {
                Toast.makeText(this, "导出失败", Toast.LENGTH_SHORT).show()
                return@evaluateJavascript
            }
            val bytes = runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull()
            if (bytes == null) {
                Toast.makeText(this, "导出失败", Toast.LENGTH_SHORT).show()
                return@evaluateJavascript
            }
            val name = guessFileName(null, contentDisposition, mimeType ?: "application/json")
            val saved = saveToDownloads(name, bytes)
            Toast.makeText(this, if (saved) "已保存到「下载」：$name" else "保存失败", Toast.LENGTH_LONG).show()
        }
    }

    private fun saveToDownloads(name: String, bytes: ByteArray): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "application/json")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
            runCatching {
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                true
            }.getOrDefault(false)
        } else {
            // API 26–28：写入应用专属外部目录，同样不需要存储权限
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return false
            runCatching { File(dir, name).writeBytes(bytes) }.isSuccess
        }
    }

    private fun guessFileName(url: String?, contentDisposition: String?, mimeType: String?): String {
        contentDisposition?.let {
            Regex("filename\\s*=\\s*\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)
                ?.takeIf { n -> n.isNotBlank() }?.let { n -> return n.trim() }
        }
        url?.let {
            Uri.parse(it).lastPathSegment?.takeIf { s -> s.contains('.') }?.let { s -> return s }
        }
        return "moodhub-export-${System.currentTimeMillis()}.json"
    }

    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    companion object {
        private const val APP_DOMAIN = "appassets.androidplatform.net"
        private const val START_URL = "https://$APP_DOMAIN/assets/www/index.html"
    }
}
