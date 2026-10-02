# Guarda y restaura una "foto" de la base local, para probar a mano un flujo
# largo (Rutas -> liquidacion -> Finanzas) sin volver a capturar los pedidos.
#
#   .\scripts\foto-bd.ps1 guardar              # foto "base"
#   .\scripts\foto-bd.ps1 guardar liquidado    # otra foto, con nombre
#   .\scripts\foto-bd.ps1 restaurar            # vuelve a la foto "base"
#   .\scripts\foto-bd.ps1 listar
#
# Restaurar BORRA la base y la recrea desde la foto: todo lo hecho despues de
# guardarla se pierde. Por eso se niega a correr contra algo que no sea
# localhost. Las fotos quedan en `.fotos-bd/`, fuera de git.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('guardar', 'restaurar', 'listar')]
  [string]$accion,
  [Parameter(Position = 1)]
  [string]$nombre = 'base'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$carpeta = Join-Path $raiz '.fotos-bd'
$archivo = Join-Path $carpeta "$nombre.dump"

if ($accion -eq 'listar') {
  if (Test-Path $carpeta) {
    Get-ChildItem $carpeta -Filter *.dump | Sort-Object LastWriteTime |
      ForEach-Object { '{0,-20} {1:yyyy-MM-dd HH:mm}  {2:N0} KB' -f $_.BaseName, $_.LastWriteTime, ($_.Length / 1KB) }
  }
  exit 0
}

# La conexion sale del mismo .env que usa la API, para no apuntar a otra base.
$linea = Get-Content (Join-Path $raiz '.env') | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $linea) { throw 'No hay DATABASE_URL en rapidix-api/.env' }
$url = [System.Uri](($linea -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"'))
$servidor = $url.Host
$puerto = if ($url.Port -gt 0) { $url.Port } else { 5432 }
$usuario, $clave = $url.UserInfo.Split(':', 2) | ForEach-Object { [System.Uri]::UnescapeDataString($_) }
$base = $url.AbsolutePath.TrimStart('/')

if ($servidor -notin @('localhost', '127.0.0.1')) {
  throw "DATABASE_URL apunta a $servidor. Este script solo trabaja contra la base local."
}

# pg_dump y pg_restore tienen que ser de la version del servidor: uno mas nuevo
# escribe ajustes que el servidor viejo no conoce. Se pregunta la version con
# cualquier psql instalado y se usan los binarios de esa carpeta.
$instalados = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\pg_dump.exe') }
if (-not $instalados) { throw 'No encuentro PostgreSQL en C:\Program Files\PostgreSQL' }

$env:PGPASSWORD = $clave
$conexion = @('-h', $servidor, '-p', $puerto, '-U', $usuario)
$psql = Join-Path $instalados[0].FullName 'bin\psql.exe'
$version = (& $psql @conexion -d postgres -Atc 'show server_version_num').Trim()
if ($LASTEXITCODE -ne 0) { throw 'No pude conectar con el servidor de Postgres.' }
$mayor = [int]([int]$version / 10000)
$bin = Join-Path 'C:\Program Files\PostgreSQL' "$mayor\bin"
if (-not (Test-Path (Join-Path $bin 'pg_dump.exe'))) {
  throw "El servidor es Postgres $mayor y no estan sus herramientas en $bin"
}

if ($accion -eq 'guardar') {
  New-Item -ItemType Directory -Force $carpeta | Out-Null
  & (Join-Path $bin 'pg_dump.exe') @conexion -d $base -Fc -f $archivo
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump fallo.' }
  Write-Host "Foto '$nombre' guardada: $archivo"
  exit 0
}

if (-not (Test-Path $archivo)) { throw "No existe la foto '$nombre'. Fotos: .\scripts\foto-bd.ps1 listar" }

# --force corta las conexiones abiertas (la API en marcha, Prisma Studio);
# sin el, dropdb se niega mientras alguien este conectado.
& (Join-Path $bin 'dropdb.exe') @conexion --force --if-exists $base
if ($LASTEXITCODE -ne 0) { throw 'dropdb fallo.' }
& (Join-Path $bin 'createdb.exe') @conexion $base
if ($LASTEXITCODE -ne 0) { throw 'createdb fallo.' }
& (Join-Path $bin 'pg_restore.exe') @conexion -d $base --no-owner --exit-on-error $archivo
if ($LASTEXITCODE -ne 0) { throw 'pg_restore fallo: la base quedo a medias, vuelve a restaurar.' }
Write-Host "Base '$base' restaurada desde la foto '$nombre'. Reinicia la API (npm run start:dev)."
