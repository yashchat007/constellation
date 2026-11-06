# Live provider probe (verification only). Does not run in CI.
$ErrorActionPreference = "Continue"
$ua = "Constellation/0.1 (benchmark)"

$songs = @(
  @{ Title = "Kesariya"; Artist = "Arijit Singh"; Album = "Brahmastra"; Duration = 268 },
  @{ Title = "Channa Mereya"; Artist = "Arijit Singh"; Album = "Ae Dil Hai Mushkil"; Duration = 289 },
  @{ Title = "Tum Hi Ho"; Artist = "Arijit Singh"; Album = "Aashiqui 2"; Duration = 285 },
  @{ Title = "Apna Bana Le"; Artist = "Arijit Singh"; Album = "Bhediya"; Duration = 261 },
  @{ Title = "Raataan Lambiyan"; Artist = "Jubin Nautiyal"; Album = "Shershaah"; Duration = 230 },
  @{ Title = "Die For You"; Artist = "The Weeknd"; Album = "Starboy"; Duration = 260 },
  @{ Title = "Love Story"; Artist = "Taylor Swift"; Album = "Fearless"; Duration = 235 },
  @{ Title = "Señorita"; Artist = "Shawn Mendes"; Album = ""; Duration = 191 },
  @{ Title = "Harleys in Hawaii"; Artist = "Katy Perry"; Album = "Smile"; Duration = 203 },
  @{ Title = "We Don't Talk Anymore"; Artist = "Charlie Puth"; Album = "Nine Track Mind"; Duration = 217 }
)

function Probe-Lrclib($a, $t, $d) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $q = "artist_name=$([uri]::EscapeDataString($a))&track_name=$([uri]::EscapeDataString($t))"
    if ($d) { $q += "&duration=$d" }
    $r = Invoke-WebRequest -Uri "https://lrclib.net/api/get?$q" -UserAgent $ua -TimeoutSec 15 -UseBasicParsing
    $sw.Stop()
    return @{ ok = $true; status = $r.StatusCode; ms = $sw.ElapsedMilliseconds; note = "body_len=$($r.Content.Length)" }
  } catch {
    $sw.Stop()
    $status = $_.Exception.Response.StatusCode.value__
    if (-not $status) { $status = "err" }
    return @{ ok = $false; status = $status; ms = $sw.ElapsedMilliseconds; note = $_.Exception.Message }
  }
}

function Probe-Lrcmux($a, $t, $d) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $q = "format=json&artist=$([uri]::EscapeDataString($a))&title=$([uri]::EscapeDataString($t))&level=word"
    if ($d) { $q += "&duration=$d" }
    $r = Invoke-WebRequest -Uri "https://api.lrcmux.dev/get?$q" -UserAgent $ua -TimeoutSec 20 -UseBasicParsing
    $sw.Stop()
    $j = $r.Content | ConvertFrom-Json
    $lines = $j.lines.Count
    $lvl = $j.meta.level
    return @{ ok = $true; status = $r.StatusCode; ms = $sw.ElapsedMilliseconds; note = "lines=$lines level=$lvl" }
  } catch {
    $sw.Stop()
    $status = $_.Exception.Response.StatusCode.value__
    if (-not $status) { $status = "err" }
    return @{ ok = $false; status = $status; ms = $sw.ElapsedMilliseconds; note = $_.Exception.Message }
  }
}

function Probe-BetterLyrics($a, $t, $al, $d) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    if (-not $al) { $al = "Unknown" }
    if (-not $d) { $d = 180 }
    $q = "s=$([uri]::EscapeDataString($t))&a=$([uri]::EscapeDataString($a))&al=$([uri]::EscapeDataString($al))&d=$d"
    $r = Invoke-WebRequest -Uri "https://api.betterlyrics.org/getLyrics?$q" -UserAgent $ua -TimeoutSec 20 -UseBasicParsing
    $sw.Stop()
    $hasSpan = $r.Content -match "<span"
    return @{ ok = $true; status = $r.StatusCode; ms = $sw.ElapsedMilliseconds; note = "ttml_spans=$hasSpan len=$($r.Content.Length)" }
  } catch {
    $sw.Stop()
    $status = $_.Exception.Response.StatusCode.value__
    if (-not $status) { $status = "err" }
    return @{ ok = $false; status = $status; ms = $sw.ElapsedMilliseconds; note = $_.Exception.Message }
  }
}

function Probe-Karalyr($a, $t, $d) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $q = "artist_name=$([uri]::EscapeDataString($a))&track_name=$([uri]::EscapeDataString($t))"
    if ($d) { $q += "&duration=$d" }
    $r = Invoke-WebRequest -Uri "https://karalyr.com/api/get?$q" -UserAgent $ua -TimeoutSec 15 -UseBasicParsing
    $sw.Stop()
    return @{ ok = $true; status = $r.StatusCode; ms = $sw.ElapsedMilliseconds; note = "len=$($r.Content.Length)" }
  } catch {
    $sw.Stop()
    $status = $_.Exception.Response.StatusCode.value__
    if (-not $status) { $status = "err" }
    return @{ ok = $false; status = $status; ms = $sw.ElapsedMilliseconds; note = $_.Exception.Message }
  }
}

Write-Output "provider,song,status,ms,ok,note"
foreach ($s in $songs) {
  $name = "$($s.Artist) - $($s.Title)"
  foreach ($p in @("lrclib","lrcmux","better","karalyr")) {
    switch ($p) {
      "lrclib" { $res = Probe-Lrclib $s.Artist $s.Title $s.Duration }
      "lrcmux" { $res = Probe-Lrcmux $s.Artist $s.Title $s.Duration }
      "better" { $res = Probe-BetterLyrics $s.Artist $s.Title $s.Album $s.Duration }
      "karalyr" { $res = Probe-Karalyr $s.Artist $s.Title $s.Duration }
    }
    Write-Output "$p,$name,$($res.status),$($res.ms),$($res.ok),$($res.note)"
    Start-Sleep -Milliseconds 300
  }
}
