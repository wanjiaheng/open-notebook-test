# update-all.ps1 - 自动检测变更并更新所有组件
Write-Host "🔍 检测变更并应用更新..." -ForegroundColor Cyan

$container = "open-notebook-test-open_notebook-1"

# 1. 重新构建前端（如果 frontend/src 有变更）
Write-Host "📦 重新构建前端..." -ForegroundColor Yellow
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 前端构建失败" -ForegroundColor Red; exit 1 }
Pop-Location

# 2. 重启前端服务
Write-Host "🔄 重启前端服务..." -ForegroundColor Yellow
docker exec $container supervisorctl restart frontend 2>$null
if ($LASTEXITCODE -ne 0) { docker restart $container }

# 3. 重启后端服务（确保 Python 代码变更生效）
Write-Host "🔄 重启后端 API 和 Worker..." -ForegroundColor Yellow
docker exec $container supervisorctl restart api worker 2>$null

# 4. 检查依赖变更（简单实现：如果 package.json 或 pyproject.toml 修改时间晚于上次安装，则重装）
$lastInstall = if (Test-Path ".last_install") { (Get-Item ".last_install").LastWriteTime } else { Get-Date "2000-01-01" }
$packageJson = Get-Item "frontend/package.json" -ErrorAction SilentlyContinue
$pyproject = Get-Item "pyproject.toml" -ErrorAction SilentlyContinue
if (($packageJson -and $packageJson.LastWriteTime -gt $lastInstall) -or ($pyproject -and $pyproject.LastWriteTime -gt $lastInstall)) {
    Write-Host "📦 检测到依赖变更，重新安装..." -ForegroundColor Yellow
    docker exec $container bash -c "cd /app/frontend && npm install" 2>&1 | Out-Host
    docker exec $container bash -c "cd /app && uv sync" 2>&1 | Out-Host
    docker exec $container supervisorctl restart all
    New-Item .last_install -type file -force | Out-Null
}

# 5. 运行数据库迁移（如果有迁移脚本）
if (Test-Path "open_notebook/migrations") {
    Write-Host "🗄️ 运行数据库迁移..." -ForegroundColor Yellow
    docker exec $container bash -c "cd /app && uv run alembic upgrade head" 2>&1 | Out-Host
}

Write-Host "✅ 全部更新完成！请刷新浏览器 (Ctrl+Shift+R)" -ForegroundColor Green