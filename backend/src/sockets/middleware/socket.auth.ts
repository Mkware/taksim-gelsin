/**
 * Socket.io JWT Kimlik Doğrulama Middleware
 * Her socket bağlantısında handshake sırasında token doğrulanır.
 * Geçersiz token ile bağlantı kurulamaz.
 *
 * Client tarafında bağlantı:
 *   io('ws://localhost:3000', { auth: { token: 'Bearer xxx' } })
 */

import { Socket } from 'socket.io';
import { verifyAccessToken } from '../../utils/jwt';
import { logger } from '../../utils/logger';
import { getUserAuthGate } from '../../middleware/auth.middleware';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../../types/socket.types';

// Tip güvenli socket tipi
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Socket bağlantısında JWT doğrulama
 * Handshake auth objesinden token alınır ve doğrulanır.
 * Başarılıysa socket.data'ya userId ve role eklenir.
 */
export async function socketAuthMiddleware(
  socket: TypedSocket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    // Auth bilgisini handshake'den al (bazı istemciler auth, bazıları Authorization header kullanır)
    const authData = socket.handshake.auth;
    const headerAuth = socket.handshake.headers.authorization;
    let token = (authData?.token as string | undefined) ?? undefined;
    if (!token && typeof headerAuth === 'string') {
      token = headerAuth;
    }

    if (!token) {
      logger.warn(`Socket bağlantı reddedildi: Token yok [${socket.id}]`);
      next(new Error('Kimlik doğrulama gerekli. auth.token gönderilmeli.'));
      return;
    }

    // "Bearer " prefix'ini temizle
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    // Token'ı doğrula
    const result = verifyAccessToken(cleanToken);

    if (!result.valid || !result.payload) {
      logger.warn(
        `Socket bağlantı reddedildi: Geçersiz token [${socket.id}] — ${result.error ?? 'bilinmeyen'}`
      );
      next(new Error(result.error || 'Geçersiz veya süresi dolmuş token.'));
      return;
    }

    const gate = await getUserAuthGate(result.payload.userId);
    if (gate === null) {
      next(new Error('Kullanıcı bulunamadı.'));
      return;
    }
    if (gate.isSuspended) {
      next(new Error('Hesabınız askıya alınmış.'));
      return;
    }

    const jwtSv = result.payload.sessionVersion ?? 0;
    if (jwtSv !== gate.sessionVersion) {
      logger.warn(`Socket reddedildi: oturum sürümü uyuşmuyor [${socket.id}] user=${result.payload.userId}`);
      next(new Error('Oturum geçersiz. Başka bir cihazdan giriş yapılmış olabilir.'));
      return;
    }

    // Doğrulanmış kullanıcı bilgilerini socket.data'ya kaydet
    // Tüm event handler'lar bu bilgiye socket.data üzerinden erişir
    socket.data.userId = result.payload.userId;
    socket.data.role = result.payload.role;
    socket.data.sessionVersion = jwtSv;

    logger.debug(`Socket kimlik doğrulandı: ${result.payload.userId} (${result.payload.role}) [${socket.id}]`);

    next();
  } catch (error) {
    logger.error(`Socket auth hatası [${socket.id}]:`, error);
    next(new Error('Kimlik doğrulama sırasında bir hata oluştu.'));
  }
}
