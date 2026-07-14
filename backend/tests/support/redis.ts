import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import type { Redis } from 'ioredis';

export async function startTestRedis(): Promise<StartedRedisContainer> {
  return new RedisContainer('redis:7-alpine').start();
}

/**
 * Testcontainers "başladı" derse de (kendi wait-strategy'si konteyner içinden
 * kontrol eder), host tarafındaki port forward'ı (özellikle colima gibi VM
 * tabanlı Docker runtime'larında) birkaç saniye geride kalabilir. src/config/redis.ts'in
 * ioredis client'ı bu yüzden ilk komutlarda ETIMEDOUT/command-timeout yiyebilir.
 * Testler bu yüzden 'ready' event'ini bekleyerek başlıyor.
 */
export async function waitForRedisReady(client: Redis, timeoutMs = 30_000): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      reject(new Error(`Redis 'ready' olmadı (${timeoutMs}ms)`));
    }, timeoutMs);
    function onReady(): void {
      clearTimeout(timer);
      resolve();
    }
    client.once('ready', onReady);
  });
}
