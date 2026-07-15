/**
 * Yolculuk içi sohbet — kalıcılık yok, mesajlar yalnızca Redis'te tutulur.
 * `ride:messages:{rideId}` LIST'i yolculuk süresince yaşar; `ride.handler.ts`
 * yolculuk `completed`/`cancelled` olduğunda bu anahtarı siler.
 */

import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import type { MessageNewEvent } from '../types/socket.types';

/** Bir yolculukta saklanan en fazla mesaj sayısı (bellek/güvenlik sınırı) */
const MAX_MESSAGES_STORED = 200;

/** Temizlik olayı kaçırılırsa (deploy/restart) diye güvenlik ağı — 24 saat sonra otomatik silinir */
const MESSAGES_TTL_SECONDS = 86400;

function messagesKey(rideId: string): string {
  return `ride:messages:${rideId}`;
}

/** Mesajı Redis LIST'ine ekler ve listeyi üst sınırda tutar */
export async function appendMessage(rideId: string, message: MessageNewEvent): Promise<void> {
  const key = messagesKey(rideId);
  await redis.rpush(key, JSON.stringify(message));
  await redis.ltrim(key, -MAX_MESSAGES_STORED, -1);
  await redis.expire(key, MESSAGES_TTL_SECONDS);
}

/** Yolculuğun tüm sohbet geçmişini (eskiden yeniye) döndürür */
export async function getMessages(rideId: string): Promise<MessageNewEvent[]> {
  const raw = await redis.lrange(messagesKey(rideId), 0, -1);
  const messages: MessageNewEvent[] = [];
  for (const item of raw) {
    try {
      messages.push(JSON.parse(item) as MessageNewEvent);
    } catch (e) {
      logger.warn(`[ride_chat] Bozuk mesaj kaydı atlandı [${rideId}]:`, e);
    }
  }
  return messages;
}

/** Yolculuk tamamlandığında/iptal edildiğinde sohbet geçmişini temizler */
export async function clearMessages(rideId: string): Promise<void> {
  await redis.del(messagesKey(rideId));
}
