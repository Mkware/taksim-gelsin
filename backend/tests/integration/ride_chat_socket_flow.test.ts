/**
 * Yolculuk içi sohbet — gerçek Socket.io sunucusu + socket.io-client bağlantıları
 * + gerçek Postgres (PostgREST üzerinden) + gerçek Redis'e karşı.
 *
 * message.handler.ts, tracking.handler.ts (oda katılımı) ve ride_chat.service.ts
 * dahil tüm GERÇEK kod çalışır — mock yok.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { startPostgrestStack, type PostgrestStack } from '../support/postgrest_stack';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';
import { insertCustomer, insertDriver, insertSearchingRide } from '../support/fixtures';
import type { StartedRedisContainer } from '@testcontainers/redis';

describe('yolculuk içi sohbet: message:send / message:get_history (gerçek socket)', () => {
  let stack: PostgrestStack;
  let redisContainer: StartedRedisContainer;
  let httpServer: http.Server;
  let baseUrl: string;

  let redis: typeof import('../../src/config/redis').redis;
  let generateAccessToken: typeof import('../../src/utils/jwt').generateAccessToken;

  beforeAll(async () => {
    [stack, redisContainer] = await Promise.all([startPostgrestStack(), startTestRedis()]);

    setDummyAppEnv({
      SUPABASE_URL: stack.postgrest.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: stack.postgrest.serviceRoleKey,
      SUPABASE_ANON_KEY: stack.postgrest.anonKey,
      REDIS_HOST: redisContainer.getHost(),
      REDIS_PORT: String(redisContainer.getPort()),
    });

    const redisConfig = await import('../../src/config/redis');
    const jwtUtils = await import('../../src/utils/jwt');
    const socketManager = await import('../../src/sockets/socket.manager');

    redis = redisConfig.redis;
    generateAccessToken = jwtUtils.generateAccessToken;

    await waitForRedisReady(redis);

    httpServer = http.createServer();
    socketManager.initSocketManager(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await redis.quit();
    await redisContainer.stop();
    await stack.stop();
  });

  function connectSocket(userId: string, role: 'customer' | 'driver'): Promise<ClientSocket> {
    const token = generateAccessToken({ userId, role, sessionVersion: 0 });
    const socket = ioClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  /** searching ride oluşturur, sonra doğrudan SQL ile accepted'e taşır (kabul akışını atlar) */
  async function insertAcceptedRide(customerId: string, driverId: string): Promise<string> {
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 120 });
    const { rows } = await stack.pool.query(
      `UPDATE rides SET status = 'accepted', driver_id = $2, accepted_at = now()
       WHERE id = $1 AND status = 'searching' RETURNING id`,
      [rideId, driverId],
    );
    expect(rows).toHaveLength(1);
    return rideId;
  }

  /** Socket bağlanınca tracking.handler.ts otomatik olarak `ride:{id}` odasına katılır — bunu bekle. */
  function waitForRideSnapshot(socket: ClientSocket, rideId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ride:snapshot gelmedi (oda katılımı doğrulanamadı)')), 10_000);
      socket.once('ride:snapshot', (payload: { ride: { id: string } }) => {
        clearTimeout(timer);
        expect(payload.ride.id).toBe(rideId);
        resolve();
      });
    });
  }

  it('mesaj gönderildiğinde her iki tarafa (gönderen dahil) message:new yayınlanır ve Redis LIST\'e yazılır', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertAcceptedRide(customerId, driverId);

    const customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');

    try {
      await Promise.all([
        waitForRideSnapshot(customerSocket, rideId),
        waitForRideSnapshot(driverSocket, rideId),
      ]);

      const onDriverGotMessage = new Promise<{ text: string; senderId: string; senderRole: string }>(
        (resolve) => driverSocket.once('message:new', resolve),
      );
      const onCustomerGotOwnMessage = new Promise<{ text: string; senderId: string }>((resolve) =>
        customerSocket.once('message:new', resolve),
      );

      customerSocket.emit('message:send', { rideId, text: 'Merhaba, 5 dakikaya oradayım.' });

      const [toDriver, toCustomer] = await Promise.all([onDriverGotMessage, onCustomerGotOwnMessage]);
      expect(toDriver.text).toBe('Merhaba, 5 dakikaya oradayım.');
      expect(toDriver.senderId).toBe(customerId);
      expect(toDriver.senderRole).toBe('customer');
      expect(toCustomer.senderId).toBe(customerId);

      // Redis LIST'e gerçekten yazıldı mı?
      const stored = await redis.lrange(`ride:messages:${rideId}`, 0, -1);
      expect(stored).toHaveLength(1);
      expect(JSON.parse(stored[0]).text).toBe('Merhaba, 5 dakikaya oradayım.');

      // message:get_history sürücü tarafından istenince geçmişi döndürür
      const history = new Promise<{ rideId: string; messages: unknown[] }>((resolve) =>
        driverSocket.once('message:history', resolve),
      );
      driverSocket.emit('message:get_history', { rideId });
      const historyPayload = await history;
      expect(historyPayload.rideId).toBe(rideId);
      expect(historyPayload.messages).toHaveLength(1);
    } finally {
      customerSocket.disconnect();
      driverSocket.disconnect();
    }
  }, 20_000);

  it('yolculuğa dahil olmayan biri message:get_history isteğinde geçmişi ALAMAZ (yetki sızıntısı yok)', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertAcceptedRide(customerId, driverId);
    const bystanderId = await insertCustomer(stack.pool);

    const customerSocket = await connectSocket(customerId, 'customer');
    const bystanderSocket = await connectSocket(bystanderId, 'customer');

    try {
      await waitForRideSnapshot(customerSocket, rideId);

      customerSocket.emit('message:send', { rideId, text: 'gizli mesaj' });
      // Sunucunun mesajı işleyip Redis'e yazmasını bekle (event'i kendimiz dinlemiyoruz).
      await new Promise((resolve) => setTimeout(resolve, 500));

      let historyReceived = false;
      bystanderSocket.on('message:history', () => {
        historyReceived = true;
      });
      bystanderSocket.emit('message:get_history', { rideId });

      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(historyReceived).toBe(false);
    } finally {
      customerSocket.disconnect();
      bystanderSocket.disconnect();
    }
  }, 20_000);

  it('yolculuk iptal edildiğinde ride:messages Redis anahtarı silinir', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertAcceptedRide(customerId, driverId);

    const customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');

    try {
      await Promise.all([
        waitForRideSnapshot(customerSocket, rideId),
        waitForRideSnapshot(driverSocket, rideId),
      ]);

      customerSocket.emit('message:send', { rideId, text: 'iptalden önce' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await redis.exists(`ride:messages:${rideId}`)).toBe(1);

      const cancelled = new Promise<{ rideId: string }>((resolve) =>
        customerSocket.once('ride:cancelled', resolve),
      );
      customerSocket.emit('ride:cancel', { rideId, reason: 'Test iptali' });
      await cancelled;

      // `ride:cancelled` müşteriye clearMessages() TAMAMLANMADAN emit edilir (handler
      // sırayla ilerler) — sunucunun temizliği bitirmesi için kısa bir tampon bekle.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await redis.exists(`ride:messages:${rideId}`)).toBe(0);
    } finally {
      customerSocket.disconnect();
      driverSocket.disconnect();
    }
  }, 20_000);
});
