import { KeyRotationService } from '../config/keyRotation';
import { config } from '../config/env';

async function runKeyHealthCheck() {
  console.log('='.repeat(70));
  console.log('  GOOGLE GEMINI API KEY POOL & HEALTH CHECK MONITOR');
  console.log('='.repeat(70));

  KeyRotationService.initializePool();
  const metrics = KeyRotationService.getKeyPoolMetrics();

  console.log(`\nConfigured Model: ${config.gemini.model}`);
  console.log(`Total Keys in Rotation Pool: ${metrics.totalKeys}`);
  console.log(`Active Keys: ${metrics.activeKeys}`);
  console.log(`Keys on Cooldown: ${metrics.cooldownKeys}`);
  console.log(`Exhausted Keys: ${metrics.exhaustedKeys}`);

  if (metrics.totalKeys === 0) {
    console.log('\n⚠️  No Gemini API keys found in environment. Platform will operate in deterministic fallback mode.');
    return;
  }

  console.log('\nKey Pool Status Table:');
  console.log('┌──────────┬──────────────────────┬─────────────┬───────────┬──────────────────────┐');
  console.log('│ Key ID   │ Name                 │ Masked Key  │ Status    │ Cooldown Remaining   │');
  console.log('├──────────┼──────────────────────┼─────────────┼───────────┼──────────────────────┤');

  for (const k of metrics.keys) {
    const cooldownStr = k.cooldownRemainingSec ? `${k.cooldownRemainingSec}s` : 'None (Active)';
    console.log(
      `│ ${k.id.padEnd(8)} │ ${k.name.padEnd(20)} │ ${k.masked.padEnd(11)} │ ${k.status.padEnd(9)} │ ${cooldownStr.padEnd(20)} │`
    );
  }
  console.log('└──────────┴──────────────────────┴─────────────┴───────────┴──────────────────────┘');

  console.log('\n[Test Ping] Verifying active client connection...');
  const client = KeyRotationService.getGenAIClient();
  if (!client) {
    console.log('⚠️  No active key client available.');
    return;
  }

  try {
    const t0 = Date.now();
    const res = await client.models.generateContent({
      model: config.gemini.model,
      contents: 'Ping: respond with "PONG".',
      config: { maxOutputTokens: 10, temperature: 0.0 },
    });
    const latency = Date.now() - t0;
    console.log(`✓ Active key ping successful! Response: "${res.text?.trim()}" (${latency} ms)`);
  } catch (err: any) {
    console.log(`⚠️  Ping failed: ${err.message}`);
    console.log('   Key automatically reported to rotation pool.');
  }

  console.log('\n✓ Health check complete.\n');
}

if (require.main === module) {
  runKeyHealthCheck().catch(err => {
    console.error('Fatal error during key health check:', err);
    process.exit(1);
  });
}

export { runKeyHealthCheck };
