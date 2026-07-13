/**
 * Redis İstemci Yapılandırması
 * Sürücü konum cache'i ve eşleştirme kuyruğu için kullanılır.
 * Bağlantı koptuğunda otomatik yeniden bağlanır.
 */

import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

// Redis bağlantı ayarları
// NOT: TLS yalnızca REDIS_TLS=true olduğunda etkin. Yerel Redis'te TLS açıksa
// bağlantı bile kurulamıyor — bu yüzden koşullu olmalı.
const redisConfig: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  // Bağlantı koptuğunda yeniden deneme stratejisi
  retryStrategy(times: number): number | null {
    const maxRetries = 10;
    if (times > maxRetries) {
      logger.error(`Redis bağlantısı ${maxRetries} denemeden sonra başarısız oldu`);
      return null; // Yeniden denemeyi durdur
    }
    const delay = Math.min(times * 200, 3000);
    logger.warn(`Redis yeniden bağlanıyor... Deneme: ${times}, Bekleme: ${delay}ms`);
    return delay;
  },
  // Komutları yanıtlanmadan önce düşürmek yerine queue'la
  enableOfflineQueue: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
  commandTimeout: 5000,
};

if (env.REDIS_TLS) {
  (redisConfig as { tls?: object }).tls = {};
}

// Ana Redis istemcisi
export const redis = new Redis(redisConfig);

// Tam bağlanma (handshake + auth + select) tamamlandığında `ready` tetiklenir.
// Yalnızca 'connect' değil 'ready'yi ölçerek hazır olup olmadığını anlıyoruz.
redis.on('ready', () => {
  logger.info('✅ Redis hazır (ana istemci)');
});

redis.on('error', (error: Error) => {
  // Hata mesajı boş olabilir (ör. ECONNRESET) — yine de anlamlı log at
  const msg = error?.message || error?.name || 'bilinmeyen hata';
  logger.error(`❌ Redis bağlantı hatası: ${msg}`);
});

redis.on('end', () => {
  logger.warn('⚠️ Redis bağlantısı kapandı (end)');
});

// Pub/Sub için ayrı Redis istemcisi (aynı bağlantı paylaşılamaz)
export const redisSub = new Redis(redisConfig);

redisSub.on('ready', () => {
  logger.info('✅ Redis Pub/Sub hazır');
});

redisSub.on('error', (error: Error) => {
  const msg = error?.message || error?.name || 'bilinmeyen hata';
  logger.error(`❌ Redis Pub/Sub bağlantı hatası: ${msg}`);
});

redisSub.on('end', () => {
  logger.warn('⚠️ Redis Pub/Sub bağlantısı kapandı (end)');
});

/**
 * Redis bağlantılarını güvenli şekilde kapatır
 * Uygulama kapatılırken çağrılır
 */
export async function closeRedisConnections(): Promise<void> {
  try {
    await redis.quit();
    await redisSub.quit();
    logger.info('Redis bağlantıları kapatıldı');
  } catch (error) {
    logger.error('Redis bağlantıları kapatılırken hata:', error);
  }
}
