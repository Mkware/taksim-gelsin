import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { DRIVER_HEARTBEAT_KEY } from '../sockets/handlers/driver.handler';
import { getSocketManager } from '../sockets/socket.manager';

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Hayalet sürücüleri (Ghost Drivers) temizleyen arka plan görevi.
 *
 * DB'de is_online + is_available olan ve aşağıdaki durumda olan sürücü hayalettir:
 *   - Heartbeat yok (yaklaşık 3 dk'dır konum / go_online sonrası yenileme yok), VE
 *   - Redis'te socket id yok VEYA bu id Socket.io üzerinde artık bağlı bir soket değil
 *
 * Neden Socket.io doğrulaması?
 *   Uygulama aniden kapatılınca `disconnect` gecikebilir veya TCP geç kapanır; Redis'te
 *   `driver:socket` 24 saat TTL ile eski socket id kalabiliyordu. Sadece `EXISTS` ile
 *   bakınca hayalet sayılmıyordu. Gerçek bağlantı `io.sockets.sockets.has(id)` ile kontrol edilir.
 *
 * Durakta hareketsiz ama uygulama açık sürücü: WebSocket yaşıyor → socket id canlı → hayalet değil
 * (heartbeat konumdan yenilenmese bile go_online heartbeat'i süresi dolana kadar korunur;
 *  konum her 5 sn geliyorsa heartbeat sürekli yenilenir).
 */
export function initDriverCleanupCron() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(async () => {
    try {
      // Sürüşte olanlar (is_available = false) hiçbir zaman temizlenmez —
      // tünel/kör nokta gibi durumlarda konum kesilse bile aktif yolculuk korunmalı.
      const { data: onlineDrivers, error } = await supabaseAdmin
        .from('drivers')
        .select('id')
        .eq('is_online', true)
        .eq('is_available', true);

      if (error) {
        logger.error('Driver cleanup cron DB hatası:', error);
        return;
      }

      if (!onlineDrivers || onlineDrivers.length === 0) return;

      let io;
      try {
        io = getSocketManager();
      } catch {
        return;
      }

      const ghostDrivers: string[] = [];

      const pipeline = redis.pipeline();
      for (const driver of onlineDrivers) {
        pipeline.exists(`${DRIVER_HEARTBEAT_KEY}${driver.id}`);
        pipeline.get(`driver:socket:${driver.id}`);
      }

      const results = await pipeline.exec();
      if (!results) return;

      for (let i = 0; i < onlineDrivers.length; i++) {
        const [heartbeatErr, heartbeatExists] = results[i * 2];
        const [socketErr, socketIdRaw] = results[i * 2 + 1];

        if (heartbeatErr || socketErr) continue;

        const hasHeartbeat = heartbeatExists === 1;
        const socketId =
          typeof socketIdRaw === 'string' && socketIdRaw.length > 0 ? socketIdRaw : null;
        const socketConnected = Boolean(socketId && io.sockets.sockets.has(socketId));

        // Kalp atışı yok ve canlı WebSocket yok → gerçekten ortada yok
        if (!hasHeartbeat && !socketConnected) {
          ghostDrivers.push(onlineDrivers[i].id as string);
        }
      }

      if (ghostDrivers.length > 0) {
        logger.info(`🧹 Temizlik: ${ghostDrivers.length} hayalet sürücü tespit edildi, çevrimdışı yapılıyor.`);

        const { error: updateError } = await supabaseAdmin
          .from('drivers')
          .update({ is_online: false, is_available: false })
          .in('id', ghostDrivers);

        if (updateError) {
          logger.error('Hayalet sürücüleri çevrimdışı yaparken DB hatası:', updateError);
        } else {
          const delPipeline = redis.pipeline();
          for (const driverId of ghostDrivers) {
            delPipeline.del(`driver:socket:${driverId}`);
            delPipeline.del(`driver:location:${driverId}`);
            delPipeline.del(`driver:active_ride:${driverId}`);
          }
          await delPipeline.exec();
          logger.info(`✅ ${ghostDrivers.length} hayalet sürücü başarıyla temizlendi.`);
        }
      }
    } catch (err) {
      logger.error('Sürücü temizlik (Ghost Driver) cron hatası:', err);
    }
  }, 60 * 1000); // Her 60 saniyede bir

  logger.info('✅ Hayalet sürücü (Ghost Driver) temizlik cron job başlatıldı (60 sn)');
}

/**
 * Sunucu kapanırken cron görevini temizler
 */
export function stopDriverCleanupCron() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info('🛑 Hayalet sürücü temizlik cron job durduruldu.');
  }
}
