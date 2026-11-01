# Render the installed MaterialIcons "chat" glyph without adding dependencies.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$vendor = Join-Path $projectRoot 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
$glyphs = Get-Content (Join-Path $vendor 'glyphmaps/MaterialIcons.json') -Raw | ConvertFrom-Json
$fonts = [System.Drawing.Text.PrivateFontCollection]::new()
$fonts.AddFontFile((Join-Path $vendor 'Fonts/MaterialIcons.ttf'))
$outline = [System.Drawing.Drawing2D.GraphicsPath]::new()
$outline.AddString([string][char]$glyphs.chat, $fonts.Families[0], 0, 1024,
    [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericTypographic)
$bounds = $outline.GetBounds()

function Write-ChatIcon([string]$Name, [int]$Size, [int]$GlyphSize, [bool]$Opaque) {
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear($(if ($Opaque) { [System.Drawing.ColorTranslator]::FromHtml('#208AEF') } else { [System.Drawing.Color]::Transparent }))
    $shape = $outline.Clone()
    $scale = $GlyphSize / [Math]::Max($bounds.Width, $bounds.Height)
    $offsetX = ($Size - $bounds.Width * $scale) / 2 - $bounds.X * $scale
    $offsetY = ($Size - $bounds.Height * $scale) / 2 - $bounds.Y * $scale
    $matrix = [System.Drawing.Drawing2D.Matrix]::new([single]$scale, 0, 0, [single]$scale, [single]$offsetX, [single]$offsetY)
    $shape.Transform($matrix)
    $graphics.FillPath([System.Drawing.Brushes]::White, $shape)
    $bitmap.Save((Join-Path $projectRoot "assets/images/$Name"), [System.Drawing.Imaging.ImageFormat]::Png)
    $matrix.Dispose()
    $shape.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-ChatIcon 'icon.png' 1024 640 $true
# Keep the entire mark inside Android's central adaptive-icon safe zone.
Write-ChatIcon 'android-icon-foreground.png' 1024 440 $false
Write-ChatIcon 'android-icon-monochrome.png' 1024 440 $false
Write-ChatIcon 'splash-icon.png' 1024 640 $false
Write-ChatIcon 'favicon.png' 64 44 $true
$outline.Dispose()
$fonts.Dispose()
