/**
 * Ana Sunucu Dosyası
 * HTTP sunucusu ve Socket.io'yu başlatır.
 * Graceful shutdown (zarif kapatma) desteği içerir.
 */

import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { closeRedisConnections } from './config/redis';
import { initSocketManager } from './sockets/socket.manager';
import { initPlatformSettings } from './services/platform_settings.service';
import { initDriverCleanupCron, stopDriverCleanupCron } from './services/driver_cleanup.service';
import {
  initStaleSearchingRecoveryCron,
  stopStaleSearchingRecoveryCron,
} from './services/stale_searching_recovery.service';
import { initOfferSweeper, stopOfferSweeper } from './services/smart_matching.service';

// HTTP sunucusu oluştur (Express app'i bağla)
const server = http.createServer(app);

// Socket.io'yu HTTP sunucusuna bağla ve başlat
const io = initSocketManager(server);

// Platform ayarlarını (Supabase + env) yükle, sonra dinlemeye başla
void (async () => {
  await initPlatformSettings();
  
  // Hayalet sürücü temizlik görevini başlat
  initDriverCleanupCron();
  initStaleSearchingRecoveryCron();
  // Dayanıklı teklif sweeper — deploy/restart sonrası kaybolan timer'ları kurtarır
  initOfferSweeper();

  server.listen(env.PORT, env.HOST, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info('  🚕 Taksim Gelsin Backend Başlatıldı');
    logger.info(`  📡 HTTP : http://${env.HOST}:${env.PORT}`);
    logger.info(`  🔌 WS   : ws://${env.HOST}:${env.PORT}`);
    logger.info(`  🌍 Ortam: ${env.NODE_ENV}`);
    logger.info('═══════════════════════════════════════════');
  });
})().catch((err) => {
  logger.error('Başlatma sırasında kritik hata:', err);
  process.exit(1);
});

// Dinleme hatası (port meşgul, izin vb.) — sessizce askıda kalmasın
server.on('error', (err: NodeJS.ErrnoException) => {
  logger.error(`HTTP sunucusu dinleme hatası (${err.code ?? 'bilinmiyor'}):`, err);
  process.exit(1);
});

// ============================================================
// GRACEful SHUTDOWN — Zarif Kapatma
// Sunucu kapatılırken açık bağlantıları düzgünce kapat
// ============================================================

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // çift sinyal koruması
  shuttingDown = true;
  logger.info(`\n${signal} sinyali alındı. Sunucu kapatılıyor...`);

  // 10 saniye içinde kapanmazsa zorla kapat (başarılı kapanışta iptal edilir)
  const forceTimer = setTimeout(() => {
    logger.error('Zarif kapatma zaman aşımı! Zorla kapatılıyor...');
    process.exit(1);
  }, 10000);

  // Arka plan görevlerini durdur (yeni iş üretmesinler)
  stopDriverCleanupCron();
  stopStaleSearchingRecoveryCron();
  stopOfferSweeper();

  // Yeni bağlantı kabul etmeyi durdur
  server.close(async () => {
    logger.info('HTTP sunucusu kapatıldı.');

    try {
      // Socket.io bağlantılarını kapat (callback ile tam kapanışı bekle)
      await new Promise<void>((resolve) => {
        io.close(() => {
          logger.info('Socket.io bağlantıları kapatıldı.');
          resolve();
        });
      });

      // Redis bağlantılarını kapat
      await closeRedisConnections();

      logger.info('Tüm bağlantılar kapatıldı. Çıkılıyor...');
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (error) {
      logger.error('Kapatma sırasında hata:', error);
      clearTimeout(forceTimer);
      process.exit(1);
    }
  });
}

// İşletim sistemi sinyallerini dinle
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Yakalanmayan hataları logla
process.on('uncaughtException', (error: Error) => {
  logger.error('Yakalanmayan hata (uncaughtException):', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  // Üretimde tek seferlik async hata tüm süreci düşürmemeli; log + izleme
  logger.error('İşlenmemiş promise reddi (unhandledRejection):', reason);
});

export { server, io };
