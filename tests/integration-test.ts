/**
 * Script de prueba para verificar la integración Uber ↔ Sierra
 * Simula un webhook de Uber y verifica el flujo completo
 * 
 * Uso: npx ts-node tests/integration-test.ts
 */

import axios from 'axios';

const MIDDLEWARE_URL = 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<boolean | void>
): Promise<void> {
  const startTime = Date.now();

  try {
    console.log(`\n▶ Ejecutando: ${name}`);
    const result = await testFn();
    const duration = Date.now() - startTime;

    results.push({
      name,
      passed: result !== false,
      message: '✓ Pasó',
      duration,
    });

    console.log(`  ✓ Completado en ${duration}ms`);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    results.push({
      name,
      passed: false,
      message: error.message,
      duration,
    });

    console.error(`  ✗ Error: ${error.message}`);
  }
}

/**
 * Prueba 1: Health Check
 */
async function testHealthCheck(): Promise<boolean> {
  const response = await axios.get(`${MIDDLEWARE_URL}/webhook/uber/health`);

  if (response.status !== 200) {
    throw new Error(`Esperado status 200, recibido ${response.status}`);
  }

  if (!response.data.success) {
    throw new Error('Health check retornó success=false');
  }

  console.log('  Services:', response.data.services);

  return true;
}

/**
 * Prueba 2: Intro Endpoint
 */
async function testIntroEndpoint(): Promise<boolean> {
  const response = await axios.get(`${MIDDLEWARE_URL}/api/v1/intro`);

  if (response.status !== 200) {
    throw new Error(`Esperado status 200, recibido ${response.status}`);
  }

  if (!response.data.success) {
    throw new Error('Intro endpoint retornó success=false');
  }

  console.log('  Endpoints:', response.data.endpoints);

  return true;
}

/**
 * Prueba 3: Webhook Reception (simulación)
 */
async function testWebhookReception(): Promise<boolean> {
  const webhookPayload = {
    event_id: `evt_test_${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    event_type: 'order.created',
    data: {
      order_id: `test_order_${Date.now()}`,
      store_id: 'store_test_123',
      timestamp: Math.floor(Date.now() / 1000),
      platform: 'eats',
    },
  };

  console.log('  Enviando webhook:', webhookPayload.event_id);

  const response = await axios.post(
    `${MIDDLEWARE_URL}/webhook/uber/orders`,
    webhookPayload
  );

  if (response.status !== 200) {
    throw new Error(`Esperado status 200, recibido ${response.status}`);
  }

  if (!response.data.success) {
    throw new Error('Webhook fue rechazado');
  }

  console.log('  Respuesta:', response.data.message);
  console.log('  Nota: El webhook se procesa en segundo plano');

  return true;
}

/**
 * Prueba 4: Invalid Webhook (validación de payload)
 */
async function testInvalidWebhook(): Promise<boolean> {
  const invalidPayload = {
    // Payload sin los campos requeridos
    foo: 'bar',
  };

  try {
    await axios.post(`${MIDDLEWARE_URL}/webhook/uber/orders`, invalidPayload);
    throw new Error('Debería rechazar payload inválido');
  } catch (error: any) {
    if (error.response?.status === 400) {
      console.log('  ✓ Rechazó correctamente el payload inválido');
      return true;
    }
    throw error;
  }
}

/**
 * Prueba 5: 404 Error Handling
 */
async function test404Handling(): Promise<boolean> {
  try {
    await axios.get(`${MIDDLEWARE_URL}/endpoint-que-no-existe`);
    throw new Error('Debería retornar 404');
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('  ✓ Retornó 404 correctamente');
      return true;
    }
    throw error;
  }
}

/**
 * Ejecutar todas las pruebas
 */
async function runAllTests(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 PRUEBAS DE INTEGRACIÓN - Sierra Uber Eats Middleware');
  console.log('='.repeat(60));

  console.log(`\nConectando a: ${MIDDLEWARE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await runTest('Health Check', testHealthCheck);
  await runTest('Intro Endpoint', testIntroEndpoint);
  await runTest('Webhook Reception', testWebhookReception);
  await runTest('Invalid Webhook Validation', testInvalidWebhook);
  await runTest('404 Error Handling', test404Handling);

  // Resumen
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE PRUEBAS');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);

  results.forEach((result) => {
    const status = result.passed ? '✓' : '✗';
    const time = `${result.duration}ms`.padStart(6);
    console.log(
      `${status} ${result.name.padEnd(30)} [${time}] - ${result.message}`
    );
  });

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} pruebas`);
  console.log(`Pasadas: ${passed} ✓`);
  console.log(`Fallidas: ${failed} ✗`);
  console.log(`Tiempo total: ${totalTime}ms`);
  console.log('='.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Ejecutar si se llama directamente
runAllTests().catch((error) => {
  console.error('\n❌ Error crítico:', error);
  process.exit(1);
});
