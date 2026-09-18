$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$assetDirectory = Join-Path $projectRoot 'installer\assets'
$iconDirectory = Join-Path $projectRoot 'src\Folio\Assets'
New-Item -ItemType Directory -Path $assetDirectory,$iconDirectory -Force | Out-Null
$green = [Drawing.Color]::FromArgb(28,91,72)
$cream = [Drawing.Color]::FromArgb(245,248,246)
function Draw-Brand([Drawing.Graphics]$Canvas, [int]$Size) {
    $Canvas.SmoothingMode = 'AntiAlias'
    $Canvas.TextRenderingHint = 'AntiAliasGridFit'
    $Canvas.Clear($green)
    $font = [Drawing.Font]::new('Georgia', $Size * .68, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $Canvas.DrawString('f.', $font, [Drawing.Brushes]::White, $Size * .18, -$Size * .025)
    $font.Dispose()
}
$images = @()
foreach ($size in @(16,24,32,48,64,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $canvas = [Drawing.Graphics]::FromImage($bitmap)
    Draw-Brand $canvas $size
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images += ,@{ Size=$size; Bytes=$stream.ToArray() }
    $stream.Dispose(); $canvas.Dispose(); $bitmap.Dispose()
}
$iconStream = [IO.File]::Create((Join-Path $iconDirectory 'Folio.ico'))
$writer = [IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($entry in $images) {
    $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$entry.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $entry.Bytes.Length
}
foreach ($entry in $images) { $writer.Write([byte[]]$entry.Bytes) }
$writer.Dispose()
$small = [Drawing.Bitmap]::new(64,64)
$canvas = [Drawing.Graphics]::FromImage($small)
Draw-Brand $canvas 64
$small.Save((Join-Path $assetDirectory 'wizard-small.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
$canvas.Dispose(); $small.Dispose()
$large = [Drawing.Bitmap]::new(328,628)
$canvas = [Drawing.Graphics]::FromImage($large)
$canvas.Clear($green)
$canvas.TextRenderingHint = 'AntiAliasGridFit'
$brandFont = [Drawing.Font]::new('Georgia',140,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$titleFont = [Drawing.Font]::new('Segoe UI',34,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$bodyFont = [Drawing.Font]::new('Malgun Gothic',20,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$canvas.DrawString('f.',$brandFont,[Drawing.Brushes]::White,38,32)
$canvas.DrawString('Folio',$titleFont,[Drawing.Brushes]::White,44,230)
$canvas.DrawString("생각을 잇는`nMarkdown",$bodyFont,[Drawing.Brushes]::White,46,290)
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(84,136,112),2)
$canvas.DrawLine($pen,46,486,282,486)
$canvas.DrawString('나만의 문서 공간',$bodyFont,[Drawing.Brushes]::White,46,514)
$large.Save((Join-Path $assetDirectory 'wizard.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
$pen.Dispose(); $brandFont.Dispose(); $titleFont.Dispose(); $bodyFont.Dispose(); $canvas.Dispose(); $large.Dispose()
Write-Output 'Folio icon and setup artwork generated.'
