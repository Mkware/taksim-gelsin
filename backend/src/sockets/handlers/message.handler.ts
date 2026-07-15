/**
 * Sohbet Socket Event Handler'ı
 * Aktif yolculuk boyunca müşteri ↔ sürücü anlık mesajlaşma.
 * Kalıcılık yok — mesajlar yalnızca Redis'te tutulur (bkz. ride_chat.service.ts).
 *
 * Dinlenen event'ler:
 *   message:send         → Mesaj gönder, ride room'una yayınla
 *   message:get_history  → Chat ekranı açıldığında geçmişi getir
 */

import { Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import * as rideService from '../../modules/ride/ride.service';
import { appendMessage, getMessages } from '../../services/ride_chat.service';
import { notifyNewMessagePush } from '../../services/push_notification.service';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  MessageSendPayload,
  MessageGetHistoryPayload,
  MessageNewEvent,
} from '../../types/socket.types';
import type { TypedSocketServer } from '../socket.manager';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const MAX_MESSAGE_LENGTH = 1000;

export function registerMessageHandlers(socket: TypedSocket, io: TypedSocketServer): void {
  const userId = socket.data.userId;
  const role = socket.data.role;

  socket.on('message:send', async (payload: MessageSendPayload) => {
    try {
      const rideId = payload?.rideId;
      const text = (payload?.text ?? '').trim();
      if (!rideId || !text || text.length > MAX_MESSAGE_LENGTH) return;

      // Yetki kontrolü: sadece bu yolculuğun müşterisi veya atanmış sürücüsü —
      // getRideById tarafı değilse 403, yolculuk yoksa 404 fırlatır.
      const ride = await rideService.getRideById(rideId, userId);
      if (ride.status === 'completed' || ride.status === 'cancelled') return;

      const message: MessageNewEvent = {
        rideId,
        id: randomUUID(),
        senderId: userId,
        senderRole: role,
        text,
        sentAt: Date.now(),
      };

      await appendMessage(rideId, message);

      io.to(`ride:${rideId}`).emit('message:new', message);

      const recipientId = role === 'customer' ? ride.driver_id : ride.customer_id;
      if (recipientId) {
        void notifyNewMessagePush({ recipientId, rideId, senderRole: role, text }).catch((e: unknown) => {
          logger.warn(`[FCM] Mesaj push hatası [${rideId}]:`, e);
        });
      }
    } catch (error) {
      logger.error(`message:send hatası [${userId}]:`, error);
    }
  });

  socket.on('message:get_history', async (payload: MessageGetHistoryPayload) => {
    try {
      const rideId = payload?.rideId;
      if (!rideId) return;

      // getRideById yetkisi olmayanlar için 403/404 fırlatır — geçmiş sızmaz.
      await rideService.getRideById(rideId, userId);

      const messages = await getMessages(rideId);
      socket.emit('message:history', { rideId, messages });
    } catch (error) {
      logger.error(`message:get_history hatası [${userId}]:`, error);
    }
  });
}
