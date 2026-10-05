#Requires -Version 5.1
<#
.SYNOPSIS
  一键把 moodhub-web 打包成 Android APK（自动准备 JDK / Android SDK / Gradle）。

.DESCRIPTION
  用法（在仓库根目录或 android/ 目录下执行）：
      powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1            # Release APK
      powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1 -Variant Debug

  工具链全部落在仓库内的 .toolchain\ 目录，不会污染系统；已安装过的优先复用：
      JDK 17        .toolchain\jdk
      Android SDK   .toolchain\android-sdk
      Gradle 8.9    .toolchain\gradle

  产物：android\dist\MoodHub-<版本>-<架构>.apk
#>
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Variant = 'Release'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AndroidDir = Join-Path $RepoRoot 'android'
$Toolchain = Join-Path $RepoRoot '.toolchain'
New-Item -ItemType Directory -Force -Path $Toolchain | Out-Null

function Invoke-Download([string]$Url, [string]$Dest) {
    Write-Host "下载 $Url" -ForegroundColor Cyan
    $tmp = "$Dest.download"
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    Move-Item -Force $tmp $Dest
}

function Expand-Zip([string]$Zip, [string]$Dest) {
    Write-Host "解压 $(Split-Path $Zip -Leaf)" -ForegroundColor Cyan
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        tar -xf $Zip -C $Dest
    } else {
        Expand-Archive -Path $Zip -DestinationPath $Dest -Force
    }
}

# ---------------------------------------------------------------- 1. JDK 17
$env:JAVA_HOME = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    Write-Host "使用系统 JAVA_HOME：$env:JAVA_HOME" -ForegroundColor Green
} else {
    $candidates = @(
        "$env:ProgramFiles\Java\jdk-17",
        "$env:ProgramFiles\Eclipse Adoptium\jdk-17*",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    ) | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

    if ($candidates) {
        $env:JAVA_HOME = $candidates.FullName
        Write-Host "检测到本机 JDK：$env:JAVA_HOME" -ForegroundColor Green
    } else {
        $jdkDir = Join-Path $Toolchain 'jdk'
        if (-not (Test-Path (Join-Path $jdkDir 'bin\java.exe'))) {
            $zip = Join-Path $Toolchain 'temurin17.zip'
            Invoke-Download 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk' $zip
            Remove-Item -Recurse -Force $jdkDir -ErrorAction SilentlyContinue
            Expand-Zip $zip $Toolchain
            Get-ChildItem $Toolchain -Directory -Filter 'jdk-17*' |
                Sort-Object Name -Descending | Select-Object -First 1 |
                ForEach-Object { Move-Item $_.FullName $jdkDir }
        }
        $env:JAVA_HOME = $jdkDir
        Write-Host "已准备 JDK 17：$env:JAVA_HOME" -ForegroundColor Green
    }
}
$env:PATH = "$($env:JAVA_HOME)\bin;$env:PATH"

# ------------------------------------------------------------ 2. Android SDK
if ($env:ANDROID_HOME -and (Test-Path (Join-Path $env:ANDROID_HOME 'platform-tools'))) {
    Write-Host "使用系统 Android SDK：$env:ANDROID_HOME" -ForegroundColor Green
} else {
    $SdkDir = Join-Path $Toolchain 'android-sdk'
    $env:ANDROID_HOME = $SdkDir
    $cmdline = Join-Path $SdkDir 'cmdline-tools'
    if (-not (Test-Path (Join-Path $cmdline 'latest\bin\sdkmanager.bat'))) {
        $zip = Join-Path $Toolchain 'cmdline-tools.zip'
        Invoke-Download 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' $zip
        New-Item -ItemType Directory -Force -Path (Join-Path $SdkDir 'cmdline-tools') | Out-Null
        Expand-Zip $zip (Join-Path $SdkDir 'cmdline-tools')
        Move-Item -Force (Join-Path $SdkDir 'cmdline-tools\cmdline-tools') (Join-Path $SdkDir 'cmdline-tools\latest')
    }

    $sdkManager = Join-Path $cmdline 'latest\bin\sdkmanager.bat'
    $env:PATH = "$($env:JAVA_HOME)\bin;$env:PATH"

    Write-Host '接受 SDK 许可协议…' -ForegroundColor Cyan
    $yes = 'y' * 200
    $yes -split '' | Out-Null
    cmd /c "echo y| `"$sdkManager`" --licenses --sdk_root=`"$SdkDir`"" | Out-Null
    1..10 | ForEach-Object { cmd /c "echo y| `"$sdkManager`" --licenses --sdk_root=`"$SdkDir`"" | Out-Null }

    Write-Host '安装 platform-tools / android-35 / build-tools…' -ForegroundColor Cyan
    & $sdkManager --sdk_root="$SdkDir" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' | Out-Null
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

# ---------------------------------------------------------------- 3. Gradle
$GradleHome = Join-Path $Toolchain 'gradle-8.9'
$GradleBat  = Join-Path $GradleHome 'bin\gradle.bat'
if (-not (Test-Path $GradleBat)) {
    $zip = Join-Path $Toolchain 'gradle-8.9.zip'
    Invoke-Download 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' $zip
    Expand-Zip $zip $Toolchain
}

# ---------------------------------------------------------------- 4. 同步 Web 资源
Write-Host '同步 Web 资源到 assets/www …' -ForegroundColor Cyan
& node (Join-Path $RepoRoot 'tools\sync-web-assets.cjs') android
if ($LASTEXITCODE -ne 0) { throw '资源同步失败：请确认已安装 Node.js 18+' }

# ---------------------------------------------------------------- 5. 构建
Set-Location $AndroidDir
$task = "assemble$Variant"
Write-Host "执行 gradle $task …" -ForegroundColor Cyan
& $GradleBat --no-daemon $task
if ($LASTEXITCODE -ne 0) { throw "Gradle 构建失败（exit $LASTEXITCODE）" }

# ---------------------------------------------------------------- 6. 收集产物
$Dist = Join-Path $AndroidDir 'dist'
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
Get-ChildItem -Path (Join-Path $AndroidDir 'app\build\outputs\apk') -Recurse -Filter '*.apk' |
    Where-Object { $_.Name -match [regex]::Escape($Variant.ToLower()) -or $Variant -eq 'Debug' } |
    ForEach-Object { Copy-Item $_.FullName $Dist -Force }

Set-Location $RepoRoot
Write-Host ''
Write-Host '构建完成，APK 位于：' -ForegroundColor Green
Get-ChildItem $Dist -Filter '*.apk' | ForEach-Object { Write-Host "  $($_.FullName)" }
