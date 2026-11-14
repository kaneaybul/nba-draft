param(
  [string]$InputDir = "processed\livedata\impactrefresh\duncd_on_cap\screenshots",
  [string]$OutputDir = "processed\livedata\impactrefresh\duncd_on_cap\ocr"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType=WindowsRuntime] | Out-Null

function Await-WinRt {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type] $ResultType
  )
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 }
  foreach ($method in $methods) {
    try {
      $generic = $method.MakeGenericMethod($ResultType)
      return $generic.Invoke($null, @($Operation)).Result
    } catch {
      # Try the next overload.
    }
  }
  throw "No compatible Windows Runtime AsTask overload worked for $ResultType"
}

$inputPath = (Resolve-Path $InputDir).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$outputPath = (Resolve-Path $OutputDir).Path
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  throw "No Windows OCR engine is available for the current user profile."
}

$allRows = New-Object System.Collections.Generic.List[object]

Get-ChildItem -Path $inputPath -Filter "*.png" | Sort-Object Name | ForEach-Object {
  $filePath = $_.FullName
  $storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($filePath)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $stem = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
  $textPath = Join-Path $outputPath "$stem.txt"
  Set-Content -Path $textPath -Value $result.Text -Encoding UTF8

  foreach ($line in $result.Lines) {
    foreach ($word in $line.Words) {
      $allRows.Add([pscustomobject]@{
        file = $_.Name
        line_text = $line.Text
        word = $word.Text
        x = [math]::Round($word.BoundingRect.X, 2)
        y = [math]::Round($word.BoundingRect.Y, 2)
        width = [math]::Round($word.BoundingRect.Width, 2)
        height = [math]::Round($word.BoundingRect.Height, 2)
      })
    }
  }
}

$allRows | Export-Csv -NoTypeInformation -Path (Join-Path $outputPath "ocr_words.csv")
