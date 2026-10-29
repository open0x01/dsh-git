#requires -Version 7
<#
.SYNOPSIS
    把本仓库的 8 个包装进一个独立的 DSH profile，用于本地调试（含 Web 面板）。

.DESCRIPTION
    为什么不能直接 `dsh plugin add <仓库目录>`：
      1. 包间依赖写的是 `workspace:^`，profile 目录不是 pnpm workspace，解析不了；
      2. pnpm 会把本地目录装成 `link:`（符号链接），链接目标的 `import '@deepseek-ai/*'`
         会从**包自己的真实路径**往上找 node_modules，找不到宿主的包 → 插件加载失败。

    这个脚本用「平铺 node_modules + 目录联接（junction）」绕开这两点：
      - 把包复制到 <InstallRoot>/packages（package.json 里 workspace:^ → file:../xxx）；
      - 在 <InstallRoot>/node_modules 建 8 个包与 @deepseek-ai 的 junction，
        其中 @deepseek-ai 直接指向 dsh 自带的那一份 —— 保证全进程只有**一份 cordis**；
      - 在 profile 的 node_modules 建同样的 junction，让加载器按包名解析得到；
      - profile 的 bundles 加上 dsh-git，由 bundle 的 cordis.patch.yml 组合 7 行插件。

.PARAMETER Profile
    profile 名，默认 gitdev（首次会自动初始化）。

.PARAMETER InstallRoot
    安装树的落点，默认放在仓库同级目录 `<仓库名>-install`。

.PARAMETER DshPackages
    dsh 自带的 @deepseek-ai 目录；默认从全局 npm 安装位置推断。

.EXAMPLE
    pwsh -File scripts/install-local.ps1
    dsh --profile gitdev

.NOTES
    重新跑本脚本即可刷新：改完代码 `pnpm build` 后重跑，profile 侧不用动。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'gitdev',
  [string]$InstallRoot,
  [string]$DshPackages
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $InstallRoot) { $InstallRoot = Join-Path (Split-Path -Parent $repo) ((Split-Path -Leaf $repo) + '-install') }
if (-not $DshPackages) {
  $DshPackages = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'
}
$profileDir = Join-Path $env:DSH_HOME "profiles\$Profile"
if (-not $env:DSH_HOME) { $profileDir = Join-Path $env:USERPROFILE '.dsh' "profiles\$Profile" }

$packages = [ordered]@{
  'dsh-git'             = 'bundle'
  'dsh-git-core'        = 'core'
  'dsh-git-local'       = 'local'
  'dsh-git-github'      = 'github'
  'dsh-git-policy'      = 'policy'
  'dsh-git-tool-git'    = 'tool-git'
  'dsh-git-tool-github' = 'tool-github'
  'dsh-git-client'      = 'client'
}

function New-Junction([string]$Path, [string]$Target) {
  if (Test-Path $Path) { cmd /c rmdir "$Path" 2>$null | Out-Null }
  cmd /c mklink /J "$Path" "$Target" | Out-Null
  if (-not (Test-Path $Path)) { throw "无法创建目录联接：$Path -> $Target" }
}

Write-Host "==> 1/5 构建（tsdown → lib/）" -ForegroundColor Cyan
Push-Location $repo
try { pnpm build | Out-Null } finally { Pop-Location }

Write-Host "==> 2/5 准备可安装副本：$InstallRoot" -ForegroundColor Cyan
$null = New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'packages')
foreach ($entry in $packages.GetEnumerator()) {
  $pkgName = $entry.Key
  $dirName = $entry.Value
  $src = Join-Path $repo "packages\$dirName"
  $dst = Join-Path $InstallRoot "packages\$dirName"
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  $null = New-Item -ItemType Directory -Force -Path $dst

  $pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
  foreach ($field in 'dependencies', 'peerDependencies', 'optionalDependencies') {
    $deps = $pkg.$field
    if ($null -eq $deps) { continue }
    foreach ($dep in @($deps.PSObject.Properties)) {
      if ($dep.Value -like 'workspace:*') {
        $depDir = if ($dep.Name -eq 'dsh-git') { 'bundle' } else { $dep.Name -replace '^dsh-git-', '' }
        $dep.Value = "file:../$depDir"
      }
    }
  }
  ($pkg | ConvertTo-Json -Depth 20) | Set-Content (Join-Path $dst 'package.json') -Encoding utf8

  foreach ($item in 'lib', 'cordis.patch.yml', 'LICENSE', 'README.md') {
    $from = Join-Path $src $item
    if (Test-Path $from) { Copy-Item $from (Join-Path $dst $item) -Recurse -Force }
  }
}

Write-Host "==> 3/5 安装树的 node_modules（含指向宿主 @deepseek-ai 的联接）" -ForegroundColor Cyan
$installModules = Join-Path $InstallRoot 'node_modules'
$null = New-Item -ItemType Directory -Force -Path $installModules
New-Junction (Join-Path $installModules '@deepseek-ai') $DshPackages
foreach ($entry in $packages.GetEnumerator()) {
  New-Junction (Join-Path $installModules $entry.Key) (Join-Path $InstallRoot "packages\$($entry.Value)")
}

Write-Host "==> 4/5 初始化 profile：$Profile" -ForegroundColor Cyan
if (-not (Test-Path $profileDir)) {
  Push-Location $repo
  try { dsh plugin --profile $Profile add (Join-Path $InstallRoot 'packages\bundle') | Out-Null } finally { Pop-Location }
}

Write-Host "==> 5/5 把包接进 profile 并开启 bundle 层" -ForegroundColor Cyan
$profileModules = Join-Path $profileDir 'node_modules'
$null = New-Item -ItemType Directory -Force -Path $profileModules
New-Junction (Join-Path $profileModules '@deepseek-ai') $DshPackages
foreach ($entry in $packages.GetEnumerator()) {
  New-Junction (Join-Path $profileModules $entry.Key) (Join-Path $InstallRoot "packages\$($entry.Value)")
}

$pkgPath = Join-Path $profileDir 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-git')
$pkg.dsh = [pscustomobject]@{ profile = [pscustomobject]@{ bundles = $bundles } }
if ($null -eq $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$pkg.dependencies | Add-Member -NotePropertyName 'dsh-git' -NotePropertyValue ("link:" + ((Join-Path $InstallRoot 'packages\bundle') -replace '\\', '/')) -Force
($pkg | ConvertTo-Json -Depth 20) | Set-Content $pkgPath -Encoding utf8

Write-Host ""
Write-Host "完成。启动：" -ForegroundColor Green
Write-Host "  dsh --profile $Profile" -ForegroundColor Yellow
Write-Host "先看组合结果（不启动）：" -ForegroundColor Green
Write-Host "  dsh --profile $Profile --dump-config | Select-String dsh-git" -ForegroundColor Yellow
Write-Host ""
Write-Host "改完代码后：pnpm build && pwsh -File scripts/install-local.ps1（profile 不用重建）" -ForegroundColor DarkGray
