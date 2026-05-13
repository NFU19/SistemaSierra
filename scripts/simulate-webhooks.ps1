# Script para simular webhooks de Uber Eats

param(
    [int]$NumOrdenes = 5,
    [string]$BaseUrl = "http://localhost:3000"
)

Write-Host "Iniciando simulacion de webhooks..." -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$errorCount = 0

for ($i = 1; $i -le $NumOrdenes; $i++) {
    $eventId = "evt_demo_$(Get-Random -Minimum 1000 -Maximum 9999)"
    $orderId = "UBER_ORDER_$(Get-Random -Minimum 10000 -Maximum 99999)"
    $timestamp = [int][double]::Parse((Get-Date -UFormat %s))
    
    Write-Host "[Orden $i/$NumOrdenes] Enviando: $orderId" -ForegroundColor Yellow
    
    $jsonBody = @"
{
  "event_id": "$eventId",
  "timestamp": $timestamp,
  "event_type": "order.created",
  "data": {
    "order_id": "$orderId",
    "store_id": "store_sierra_demo",
    "timestamp": $timestamp,
    "platform": "eats"
  }
}
"@

    try {
        $response = curl.exe -s -X POST "$BaseUrl/webhook/uber/orders" `
            -H "Content-Type: application/json" `
            -d $jsonBody
        
        if ($response -match '"success":true') {
            Write-Host "[OK] Aceptado" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "[ERROR] $response" -ForegroundColor Red
            $errorCount++
        }
    } catch {
        Write-Host "[ERROR] $_" -ForegroundColor Red
        $errorCount++
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "RESULTADOS:" -ForegroundColor Cyan
Write-Host "Exitosas: $successCount" -ForegroundColor Green
Write-Host "Errores: $errorCount" -ForegroundColor Red
Write-Host ""
Write-Host "Abre el POS: http://localhost:3000/pos" -ForegroundColor Cyan
