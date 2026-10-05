plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.moodhub.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.moodhub.app"
        // minSdk 26（Android 8.0）：自适应图标无需 PNG 回退，覆盖面约 98%
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        resourceConfigurations += listOf("zh", "en")
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 本地直装便利起见先用 debug 签名；上架应用市场请换成自己的 keystore
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    // WebViewAssetLoader：把 assets 映射成 https://appassets.androidplatform.net
    // 这样页面拥有真正的「安全上下文」与持久 localStorage，等价于线上浏览器行为
    implementation("androidx.webkit:webkit:1.12.1")
}
