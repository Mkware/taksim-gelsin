/**
 * Socket.io Yöneticisi
 * HTTP sunucusuna Socket.io bağlar, JWT middleware ve event handler'ları kurar.
 *
 * Akış:
 *   1. Client bağlanır → socketAuthMiddleware JWT doğrular
 *   2. Doğrulama başarılı → socket.data'ya userId/role eklenir
 *   3. Handler'lar kaydedilir (driver, ride, tracking)
 *   4. Kullanıcı rolüne göre room'lara eklenir
 */

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/socket.types';
import { socketAuthMiddleware } from './middleware/socket.auth';
import { registerDriverHandlers } from './handlers/driver.handler';
import { registerRideHandlers } from './handlers/ride.handler';
import { registerTrackingHandlers } from './handlers/tracking.handler';

// Tip güvenli Socket.io sunucusu
export type TypedSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// Global io referansı (diğer modüllerden erişim için)
let ioInstance: TypedSocketServer;

// Bağlı kullanıcı sayısı takibi
let connectedCount = 0;

/**
 * Socket.io sunucusunu başlatır ve yapılandırır
 * @param httpServer HTTP sunucu örneği
 * @returns Yapılandırılmış Socket.io sunucusu
 */
export function initSocketManager(httpServer: HttpServer): TypedSocketServer {
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());

  // Socket.io sunucusu oluştur
  const io: TypedSocketServer = new Server(httpServer, {
    cors: {
      // Mobil istemcilerde Origin bazen gelmez; Express CORS ile aynı kural
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Socket.io CORS: ${origin} origin'ine izin verilmiyor.`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Bağlantı ayarları
    pingTimeout: 60000,
    pingInterval: 25000,
    // Transport tercihi (WebSocket öncelikli)
    transports: ['websocket', 'polling'],
  });

  // Global referansı kaydet
  ioInstance = io;

  // ============================================================
  // JWT MIDDLEWARE — Her bağlantıda token doğrulaması
  // ============================================================
  io.use(socketAuthMiddleware);

  // ============================================================
  // BAĞLANTI YÖNETİMİ
  // ============================================================
  io.on('connection', (socket) => {
    connectedCount++;
    const { userId, role } = socket.data;

    logger.info(
      `🔌 Socket bağlantısı: ${userId} (${role}) [${socket.id}] — Toplam: ${connectedCount}`
    );

    // ============================================================
    // TEK AKTİF BAĞLANTI — aynı kullanıcının eski socket'lerini kapat
    // Çift bağlantı = çift event (ride:accepted, konum yayını) ve Redis "son yazan
    // kazanır" tutarsızlıkları. `replaced` bayrağı ile eski socket'in disconnect
    // handler'ı "çevrimdışı yap" mantığını atlar (reconnect'te yanlış offline olmaz).
    // ============================================================
    try {
      for (const [, other] of io.sockets.sockets) {
        if (other.id !== socket.id && other.data?.userId === userId) {
          other.data.replaced = true;
          logger.debug(`🔁 Eski socket kapatılıyor (tek aktif bağlantı): ${userId} eski=${other.id} yeni=${socket.id}`);
          other.disconnect(true);
        }
      }
    } catch (e) {
      logger.warn(`Tek aktif bağlantı temizliği hatası [${userId}]:`, e);
    }

    // ============================================================
    // EVENT HANDLER'LARI KAYDET
    // ============================================================

    // Sürücü event'leri: online/offline, konum güncelleme
    registerDriverHandlers(socket, io);

    // Yolculuk event'leri: istek, kabul/ret, durum geçişleri
    registerRideHandlers(socket, io);

    // Canlı takip: bağlantı kurulduğunda aktif yolculuk kontrolü
    registerTrackingHandlers(socket, io);

    // ============================================================
    // BAĞLANTI KOPMA
    // ============================================================
    socket.on('disconnect', (reason) => {
      connectedCount--;
      logger.info(
        `🔌 Socket koptu: ${userId} (${role}) [${socket.id}], Sebep: ${reason} — Toplam: ${connectedCount}`
      );
    });

    // Hata durumunda
    socket.on('error', (error) => {
      logger.error(`🔌 Socket hatası [${socket.id}] ${userId}:`, error);
    });
  });

  logger.info('✅ Socket.io yöneticisi başlatıldı (JWT auth + 3 handler)');
  return io;
}

/**
 * Global Socket.io örneğini döndürür
 * Diğer modüllerden socket event göndermek için kullanılır
 */
export function getIO(): TypedSocketServer {
  if (!ioInstance) {
    throw new Error('Socket.io henüz başlatılmadı! initSocketManager önce çağrılmalı.');
  }
  return ioInstance;
}

/** smart_matching.service ile uyumlu alias */
export function getSocketManager(): TypedSocketServer {
  return getIO();
}

/**
 * Bağlı kullanıcı sayısını döndürür (monitoring amaçlı)
 */
export function getConnectedCount(): number {
  return connectedCount;
}

/**
 * Aynı kullanıcıya ait tüm socket bağlantılarını keser (aktif oturumdan çıkış)
 */
export function disconnectSocketsForUser(userId: string): void {
  try {
    const io = getIO();
    for (const [, socket] of io.sockets.sockets) {
      if (socket.data.userId === userId) {
        socket.emit('auth:session_ended', { reason: 'logout' });
        socket.disconnect(true);
      }
    }
  } catch {
    // Sunucu başlatılmadan çağrılırsa yok say
  }
}

/**
 * Yeni giriş sonrası: sadece eski oturum sürümündeki bağlantıları keser.
 * Aktif sessionVersion ile eşleşen socket'e dokunulmaz (aynı anda kurulan yeni bağlantı korunur).
 */
export function disconnectStaleSocketsForUser(userId: string, activeSessionVersion: number): void {
  try {
    const io = getIO();
    for (const [, socket] of io.sockets.sockets) {
      if (socket.data.userId !== userId) continue;
      const sv = socket.data.sessionVersion;
      const socketSv = typeof sv === 'number' ? sv : -1;
      if (socketSv !== activeSessionVersion) {
        socket.emit('auth:session_ended', { reason: 'other_device_login' });
        socket.disconnect(true);
      }
    }
  } catch {
    // ignore
  }
}
