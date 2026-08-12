param([int]$Port=8080)
$Root=$PSScriptRoot
$listener=New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try{ $listener.Start() }catch{
  Write-Host "端口 $Port 被占用，换一个：.\start-server.ps1 -Port 8081" -ForegroundColor Red
  Read-Host "回车退出"; exit 1
}
Write-Host ""
Write-Host "  履约云已启动" -ForegroundColor Green
Write-Host "  请在浏览器打开： http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""
Write-Host "  关掉这个窗口就停止服务（数据不会丢，存在浏览器/云端）"
Write-Host ""
Start-Process "http://localhost:$Port"
$types=@{".html"="text/html; charset=utf-8";".js"="text/javascript; charset=utf-8";".css"="text/css; charset=utf-8";".json"="application/json; charset=utf-8";".sql"="text/plain; charset=utf-8";".md"="text/plain; charset=utf-8"}
while($listener.IsListening){
  try{
    $ctx=$listener.GetContext()
    $rel=[Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if($rel -eq ""){ $rel="index.html" }
    $path=Join-Path $Root $rel
    if((Test-Path $path -PathType Leaf) -and $path.StartsWith($Root)){
      $ext=[IO.Path]::GetExtension($path).ToLower()
      $ctx.Response.ContentType=$(if($types.ContainsKey($ext)){$types[$ext]}else{"application/octet-stream"})
      $bytes=[IO.File]::ReadAllBytes($path)
      $ctx.Response.ContentLength64=$bytes.Length
      $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
    } else { $ctx.Response.StatusCode=404 }
    $ctx.Response.Close()
  } catch { }
}
