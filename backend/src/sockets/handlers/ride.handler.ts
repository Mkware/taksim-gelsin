/**
 * Yolculuk Socket Event Handler'ları
 * Yolculuk isteği, kabul/ret, durum geçişleri.
 *
 * Dinlenen event'ler:
 *   ride:request   → Müşteri yolculuk ister
 *   ride:accept    → Sürücü kabul eder
 *   ride:reject    → Sürücü reddeder
 *   ride:arrived   → Sürücü biniş noktasına vardı
 *   ride:start     → Yolculuk başladı
 *   ride:complete  → Yolculuk tamamlandı
 *   ride:cancel    → Yolculuk iptal edildi
 */

import { Socket } from 'socket.io';
import { supabaseAdmin } from '../../config/supabase';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error.middleware';
import * as rideService from '../../modules/ride/ride.service';
import { estimateArrivalTime, Coordinates } from '../../utils/distance';
import { decodeEwkbPoint } from '../../utils/geo';
import { computeRideAcceptFeeTcoin } from '../../services/platform_settings.service';
import * as walletService from '../../services/wallet.service';
import { forceDriverOfflineIfBalanceAtOrBelow } from '../../services/driver_online_policy.service';
import {
  startSmartMatching,
  handleSmartRejection,
  handleSmartAcceptance,
  clearSmartMatchingQueue,
} from '../../services/smart_matching.service';
import { sendCustomerDriverArrivedPush, notifyRideCancelledByFcm } from '../../services/push_notification.service';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  RideRequestPayload,
  RideAcceptPayload,
  RideRejectPayload,
  RideArrivedPayload,
  RideStartPayload,
  RideCompletePayload,
  RideCancelPayload,
  RideVerifyPickupCodePayload,
} from '../../types/socket.types';
import type { TypedSocketServer } from '../socket.manager';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Yolculuk event handler'larını socket'e bağlar
 */
export function registerRideHandlers(socket: TypedSocket, io: TypedSocketServer): void {
  const userId = socket.data.userId;
  const role = socket.data.role;

  /**
   * ride:request — Müşteri yolculuk ister
   * Bu event eşleştirme servisini tetikler (ADIM 6'da detaylandırılacak)
   * Burada temel yolculuk oluşturma ve müşteriyi room'a ekleme yapılır
   */
  if (role === 'customer') {
    // Müşteriyi kendi room'una ekle (bildirimler için)
    socket.join(`customer:${userId}`);

    socket.on('ride:request', async (payload: RideRequestPayload) => {
      try {
        // Temel input doğrulama — bozuk payload erkenden reddedilsin
        const { pickup, dropoff, pickupAddress, dropoffAddress, distanceKm } = payload ?? ({} as RideRequestPayload);
        const validPoint = (p: { lat?: number; lng?: number } | undefined): boolean =>
          !!p &&
          Number.isFinite(Number(p.lat)) &&
          Number.isFinite(Number(p.lng)) &&
          Number(p.lat) >= -90 && Number(p.lat) <= 90 &&
          Number(p.lng) >= -180 && Number(p.lng) <= 180;

        if (!validPoint(pickup) || !validPoint(dropoff)) {
          socket.emit('ride:no_driver_found', { rideId: '' });
          logger.warn(`ride:request reddedildi [${userId}]: geçersiz koordinat`);
          return;
        }

        logger.info(`🚕 Yolculuk isteği: ${userId}, ${pickupAddress} → ${dropoffAddress}`);

        // Yolculuğu veritabanına kaydet
        const ride = await rideService.createRide(userId, {
          pickup,
          dropoff,
          pickup_address: pickupAddress,
          dropoff_address: dropoffAddress,
          distance_km: distanceKm,
        });

        // Müşteriyi yolculuk room'una ekle (durum güncellemeleri için)
        socket.join(`ride:${ride.id}`);

        // Müşteri uygulamasına gerçek rideId (iptal / durum için zorunlu; temp id kullanılmamalı).
        // ÖNEMLİ: rideId istemciye eşleştirme başlamadan ÖNCE gönderilir;
        // böylece arama ekranı temp id'den gerçek id'ye geçer ve müşteri
        // istediğinde iptal edebilir.
        io.to(`customer:${userId}`).emit('ride:searching', { rideId: ride.id });

        // Eşleştirme servisini başlat — yakın sürücüleri bul ve istek gönder
        await startSmartMatching(ride.id, pickup.lat, pickup.lng, userId);

        logger.info(`📋 Yolculuk oluşturuldu, eşleştirme başlatıldı: ${ride.id}`);
      } catch (error) {
        logger.error(`ride:request hatası [${userId}]:`, error);
        // Müşteri "aranıyor" ekranında sonsuza kadar takılmasın — anında
        // bilgi gönder; istemci toast ve iptal et.
        try {
          socket.emit('ride:no_driver_found', { rideId: '' });
        } catch {
          // emit hata verirse de sorun yok
        }
      }
    });
  }

  /**
   * ride:accept — Sürücü yolculuğu kabul eder
   * 1. Yolculuk durumunu 'accepted' olarak güncelle
   * 2. Sürücüyü meşgul (is_available=false) yap
   * 3. Müşteriye sürücü bilgilerini gönder
   * 4. Eşleştirme kuyruğundan çıkar
   */
  if (role === 'driver') {
    socket.on('ride:accept', async (payload: RideAcceptPayload) => {
      try {
        const { rideId } = payload;
        if (!rideId) return;

        // Eşleştirme süresinin dolup dolmadığını (veya başkasına geçip geçmediğini) kontrol et.
        // Not: Bu kontrol sadece "erken çıkış" amaçlıdır — gerçek atomik kazanan,
        // updateRideStatus içindeki searching→accepted koşullu update'tir.
        const pendingDriver = await redis.get(`ride:pending:${rideId}`);
        if (pendingDriver && pendingDriver !== userId) {
          socket.emit('ride:accept_failed', {
            rideId,
            reason: 'TIMEOUT',
            message: 'Süre doldu veya çağrı başka sürücüye geçti.',
          });
          // İstemci tarafında modal'ı kapatmak için cancel da gönder
          socket.emit('ride:request_cancelled', {
            rideId,
            reason: 'timeout',
            message: 'Süre doldu veya çağrı başka sürücüye geçti.',
          });
          return;
        }
        // Timeout / eşleştirme pending'i sildiyse teklif yok — cüzdan kesmeden çık
        if (!pendingDriver) {
          socket.emit('ride:accept_failed', {
            rideId,
            reason: 'TIMEOUT',
            message: 'Çağrı süresi doldu veya teklif artık geçerli değil.',
          });
          socket.emit('ride:request_cancelled', {
            rideId,
            reason: 'timeout',
            message: 'Çağrı süresi doldu veya teklif artık geçerli değil.',
          });
          return;
        }

        const { data: rideForFee } = await supabaseAdmin
          .from('rides')
          .select('estimated_price')
          .eq('id', rideId)
          .maybeSingle();
        const acceptFee = computeRideAcceptFeeTcoin(
          Number((rideForFee as { estimated_price?: number } | null)?.estimated_price ?? 0),
        );

        // ATOMİK kabul + ücret kesintisi — tek PostgreSQL transaction.
        // Kabul olmazsa kesinti yapılmaz; bakiye yetersizse kabul de geri alınır.
        // Böylece "kestik ama kabul olmadı" / çift kesinti / başarısız iade riski ortadan kalkar.
        const pickupPin = rideService.generatePickupVerificationCode();
        const acceptResult = await walletService.acceptRideWithFee(rideId, userId, acceptFee, pickupPin);
        if (!acceptResult.ok) {
          if (acceptResult.code === 'INSUFFICIENT_BALANCE') {
            socket.emit('ride:accept_failed', {
              rideId,
              reason: 'INSUFFICIENT_BALANCE',
              message: 'Yetersiz T Coin. Kabul için cüzdanınıza yükleme yapın.',
            });
            return;
          }
          // RIDE_UNAVAILABLE veya RPC_ERROR — çağrı artık kabul edilemiyor (kesinti yapılmadı).
          logger.warn(`ride:accept reddedildi [${userId}][${rideId}]: ${acceptResult.code}`);
          socket.emit('ride:accept_failed', {
            rideId,
            reason: 'TIMEOUT',
            message: 'Bu çağrı artık kabul edilemiyor (iptal edildi veya başka sürücüye verildi).',
          });
          io.to(`driver:${userId}`).emit('ride:request_cancelled', {
            rideId,
            reason: 'accept_failed',
            message: 'Bu çağrı artık kabul edilemiyor (iptal edildi veya başka sürücüye verildi).',
          });
          return;
        }
        const ride = acceptResult.ride;

        // Timeout / sıra: Redis’teki bekleyeni kapat. Bildirim GÖNDERME — pending
        // hâlâ kabul eden sürücü; `true` olsa "başka sürücü kabul etti" yanlış gider.
        try {
          await clearSmartMatchingQueue(rideId, false, 'accepted_by_other');
        } catch (clearEarlyErr) {
          logger.warn(`ride:accept erken eşleştirme temizliği [${rideId}]:`, clearEarlyErr);
        }

        // Kabul DB'ye yazıldı — müşteriye HEMEN bildir, detaylar paralelde zenginleştirilir.
        const pinRawEarly = (ride as { pickup_verification_code?: string | null })
          .pickup_verification_code;
        const verificationCodeForDriver =
          pinRawEarly != null && String(pinRawEarly).trim() !== ''
            ? String(pinRawEarly).trim()
            : '';

        // ── 1. Anında müşteri bildirimi (< 1 ms — DB sorgusuz) ──
        io.to(`customer:${ride.customer_id}`).emit('ride:accepted', {
          rideId,
          verificationCode: verificationCodeForDriver,
          pickupVerificationCode: verificationCodeForDriver,
          pickup_verification_code: verificationCodeForDriver,
          driverInfo: { id: userId, fullName: '', phone: '', rating: 5,
            vehiclePlate: '', vehicleModel: '', vehicleColor: '', lat: 0, lng: 0 },
          eta: 5,
        });
        logger.info(`✅ Yolculuk kabul edildi (anlık bildirim): ${rideId}, Sürücü: ${userId}`);

        // ── 2. Paralel zenginleştirme — sürücü + müşteriye tam bilgi ──
        try {
          const [
            ,
            geoRow,
            driverRes,
            userRes,
            locationStr,
            balRow,
          ] = await Promise.all([
            handleSmartAcceptance(rideId, userId).catch((e: unknown) => {
              logger.warn(`handleSmartAcceptance [${rideId}]:`, e);
            }),
            supabaseAdmin
              .from('rides')
              .select('pickup_location, dropoff_location')
              .eq('id', rideId)
              .maybeSingle()
              .then((r) => r.data),
            supabaseAdmin
              .from('drivers')
              .select('vehicle_plate, vehicle_model, vehicle_color')
              .eq('id', userId)
              .maybeSingle(),
            supabaseAdmin
              .from('users')
              .select('full_name, phone, rating')
              .eq('id', userId)
              .maybeSingle(),
            redis.get(`driver:location:${userId}`),
            supabaseAdmin
              .from('drivers')
              .select('balance')
              .eq('id', userId)
              .maybeSingle(),
          ]);

          // ride:reveal_location → sürücüye
          try {
            const pu = decodeEwkbPoint(geoRow?.pickup_location);
            const dr = decodeEwkbPoint(geoRow?.dropoff_location);
            if (pu && dr) {
              io.to(`driver:${userId}`).emit('ride:reveal_location', {
                rideId,
                pickup: { lat: pu.lat, lng: pu.lng },
                dropoff: { lat: dr.lat, lng: dr.lng },
                balanceTcoin: Number((balRow?.data as { balance?: number } | null)?.balance ?? 0),
                pickupVerificationCode: verificationCodeForDriver || undefined,
              });
            }
          } catch (geoErr) {
            logger.warn(`ride:reveal_location gönderilemedi [${rideId}]:`, geoErr);
          }

          void forceDriverOfflineIfBalanceAtOrBelow(userId, io, 0);

          // Konum & ETA hesapla
          let location = { lat: 0, lng: 0 };
          if (locationStr) {
            try { location = JSON.parse(locationStr) as { lat: number; lng: number }; } catch { /* */ }
          }

          let eta = 5;
          const pu2 = decodeEwkbPoint(geoRow?.pickup_location);
          if (pu2) {
            const from: Coordinates = { lat: location.lat ?? 0, lng: location.lng ?? 0 };
            eta = estimateArrivalTime(from, { lat: pu2.lat, lng: pu2.lng });
          }

          const driverData = driverRes.data;
          const userData = userRes.data;

          // ride:accepted zengin bilgi — mobil ilk emit'i alıp UI'ı güncelledi;
          // bu ikinci emit sürücü adı / araç / konum / ETA ile günceller.
          io.to(`customer:${ride.customer_id}`).emit('ride:accepted', {
            rideId,
            verificationCode: verificationCodeForDriver,
            pickupVerificationCode: verificationCodeForDriver,
            pickup_verification_code: verificationCodeForDriver,
            driverInfo: {
              id: userId,
              fullName: userData?.full_name || '',
              phone: userData?.phone || '',
              rating: userData?.rating || 5,
              vehiclePlate: driverData?.vehicle_plate || '',
              vehicleModel: driverData?.vehicle_model || '',
              vehicleColor: driverData?.vehicle_color || '',
              lat: location.lat ?? 0,
              lng: location.lng ?? 0,
            },
            eta,
          });
        } catch (postAcceptErr) {
          logger.error(`ride:accept zenginleştirme hata [${userId}][${rideId}]:`, postAcceptErr);
        } finally {
          try { socket.join(`ride:${rideId}`); } catch { /* */ }
          try { await redis.set(`driver:active_ride:${userId}`, rideId, 'EX', 86400); } catch { /* */ }
          try { await clearSmartMatchingQueue(rideId, false); } catch (clearErr) {
            logger.warn(`ride:accept clearSmartMatchingQueue [${rideId}]:`, clearErr);
          }
        }
      } catch (error) {
        logger.error(`ride:accept hatası [${userId}]:`, error);
      }
    });

    /**
     * ride:reject — Sürücü yolculuğu reddeder
     * Eşleştirme servisi sıradaki sürücüye geçer
     */
    socket.on('ride:verify_pickup_code', async (payload: RideVerifyPickupCodePayload) => {
      const rideIdForErr = payload?.rideId ?? '';
      try {
        const { rideId, code } = payload;
        if (!rideId || code == null || String(code).trim() === '') {
          socket.emit('ride:pickup_code_result', {
            rideId: rideId || '',
            ok: false,
            message: 'Yolculuk veya kod eksik.',
          });
          return;
        }

        const result = await rideService.verifyPickupCode(rideId, userId, String(code));
        if (result.ok) {
          socket.emit('ride:pickup_code_result', { rideId, ok: true });
        } else {
          socket.emit('ride:pickup_code_result', { rideId, ok: false, message: result.reason });
        }
      } catch (error) {
        logger.error(`ride:verify_pickup_code hatası [${userId}]:`, error);
        socket.emit('ride:pickup_code_result', {
          rideId: rideIdForErr,
          ok: false,
          message: 'Doğrulama başarısız.',
        });
      }
    });

    socket.on('ride:reject', async (payload: RideRejectPayload) => {
      try {
        const { rideId } = payload;
        if (!rideId) return;

        const { data: row } = await supabaseAdmin
          .from('rides')
          .select('customer_id, pickup_location, status')
          .eq('id', rideId)
          .maybeSingle();

        // Reddetme isteği gelirken yolculuk artık searching değilse
        // (örn. başka sürücü kabul etti / müşteri iptal etti) sıradakine
        // geçmeye çalışma — sadece sürücü UI'sini hızla kapat.
        const status = (row?.status as string | undefined) ?? '';
        if (!row || status !== 'searching') {
          socket.emit('ride:request_cancelled', {
            rideId,
            reason: 'accept_failed',
            message: 'Bu çağrı artık geçerli değil.',
          });
          return;
        }

        const customerId = row?.customer_id ?? '';
        const pt = decodeEwkbPoint(row?.pickup_location);
        const pickupLat = pt?.lat ?? 0;
        const pickupLng = pt?.lng ?? 0;

        await handleSmartRejection(rideId, userId, customerId, pickupLat, pickupLng);

        logger.info(`❌ Yolculuk reddedildi: ${rideId}, Sürücü: ${userId}`);
      } catch (error) {
        logger.error(`ride:reject hatası [${userId}]:`, error);
      }
    });

    /**
     * ride:arrived — Sürücü biniş noktasına vardı
     */
    socket.on('ride:arrived', async (payload: RideArrivedPayload) => {
      try {
        const { rideId } = payload;
        if (!rideId) return;

        const updated = await rideService.updateRideStatus(rideId, 'arriving', userId);

        // Yolculuk room'u — hedef yolcu id ile istemci yanlış eşleşmeyi yok sayar
        io.to(`ride:${rideId}`).emit('ride:driver_arrived', {
          rideId,
          targetCustomerId: updated.customer_id,
        });

        void sendCustomerDriverArrivedPush(
          updated.customer_id,
          rideId,
          updated.pickup_address ?? '',
        );

        logger.info(`📍 Sürücü biniş noktasına vardı: ${rideId}`);
      } catch (error) {
        logger.error(`ride:arrived hatası [${userId}]:`, error);
        if (error instanceof AppError) {
          socket.emit('ride:start_rejected', {
            rideId: payload?.rideId ?? '',
            message: error.message,
          });
        }
      }
    });

    /**
     * ride:start — Yolculuk başladı (müşteri bindi)
     */
    socket.on('ride:start', async (payload: RideStartPayload) => {
      const { rideId } = payload;
      try {
        await rideService.updateRideStatus(rideId, 'in_progress', userId);

        io.to(`ride:${rideId}`).emit('ride:started', { rideId });

        logger.info(`🚗 Yolculuk başladı: ${rideId}`);
      } catch (error) {
        logger.error(`ride:start hatası [${userId}]:`, error);
        if (error instanceof AppError) {
          socket.emit('ride:start_rejected', { rideId, message: error.message });
        }
      }
    });

    /**
     * ride:complete — Yolculuk tamamlandı
     */
    socket.on('ride:complete', async (payload: RideCompletePayload) => {
      try {
        const { rideId } = payload;
        const rawFinalPrice = (payload as { finalPrice?: unknown }).finalPrice;

        // finalPrice sunucu tarafında doğrulanır; client değerini güvensiz kabul et
        let finalPrice: number | undefined;
        if (rawFinalPrice !== undefined && rawFinalPrice !== null) {
          const parsed = Number(rawFinalPrice);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
            socket.emit('ride:complete_failed', {
              rideId,
              message: 'Geçersiz yolculuk ücreti (0 – 100.000 TL arası olmalı).',
            });
            return;
          }
          finalPrice = parsed;
        }

        const ride = await rideService.updateRideStatus(rideId, 'completed', userId, {
          finalPrice,
        });

        io.to(`ride:${rideId}`).emit('ride:completed', {
          rideId,
          finalPrice: finalPrice || ride.estimated_price,
        });

        // Room'u temizle
        io.socketsLeave(`ride:${rideId}`);

        // Sürücü aktif yolculuk cache'ini temizle
        if (ride.driver_id) {
          await redis.del(`driver:active_ride:${ride.driver_id}`);
        }

        logger.info(`🏁 Yolculuk tamamlandı: ${rideId}, Ücret: ${finalPrice} TL`);
      } catch (error) {
        logger.error(`ride:complete hatası [${userId}]:`, error);
        const rideIdSafe = (payload as { rideId?: string })?.rideId ?? '';
        if (error instanceof AppError) {
          socket.emit('ride:complete_failed', {
            rideId: rideIdSafe,
            message: error.message,
          });
        } else {
          socket.emit('ride:complete_failed', {
            rideId: rideIdSafe,
            message: 'Yolculuk tamamlanamadı, lütfen tekrar deneyin.',
          });
        }
      }
    });
  }

  /**
   * ride:cancel — Yolculuk iptal (müşteri veya sürücü)
   */
  socket.on('ride:cancel', async (payload: RideCancelPayload) => {
    try {
      const { rideId, reason } = payload;
      let targetRideId = rideId;
      let cancelledRide: Awaited<ReturnType<typeof rideService.updateRideStatus>> | null = null;
      /** Yalnızca DB gerçekten cancelled olduysa FCM (mükerrer iptalde tekrar gönderme). */
      let shouldNotifyFcm = false;

      const hydrateCancelledRide = async (id: string) => {
        const { data } = await supabaseAdmin
          .from('rides')
          .select(
            'id, customer_id, driver_id, pickup_address, dropoff_address, distance_km, estimated_price, final_price, status, requested_at, accepted_at, started_at, completed_at, cancelled_at, cancel_reason',
          )
          .eq('id', id)
          .maybeSingle();
        return data as Awaited<ReturnType<typeof rideService.updateRideStatus>> | null;
      };

      try {
        cancelledRide = await rideService.updateRideStatus(rideId, 'cancelled', userId, {
          cancelReason: reason,
        });
        shouldNotifyFcm = true;
      } catch (firstErr) {
        // Müşteri: yanlış/temp rideId veya yolculuk artık searching değilse — DB'deki aktif yolculuğu çöz
        if (role === 'customer') {
          const isRideMissing =
            firstErr instanceof AppError &&
            (firstErr.statusCode === 404 || firstErr.message.includes('Yolculuk bulunamadı'));
          if (isRideMissing) {
            const fallbackId =
              (await rideService.findSearchingRideIdForCustomer(userId)) ??
              (await rideService.findActiveRideIdForCustomer(userId));
            if (fallbackId) {
              targetRideId = fallbackId;
              cancelledRide = await rideService.updateRideStatus(targetRideId, 'cancelled', userId, {
                cancelReason: reason,
              });
              shouldNotifyFcm = true;
            } else {
              throw firstErr;
            }
          } else if (
            firstErr instanceof AppError &&
            firstErr.message.includes("Geçersiz durum geçişi: 'cancelled' → 'cancelled'")
          ) {
            // İstemciden mükerrer iptal geldiğinde idempotent davran:
            // DB zaten cancelled ise event'leri yine de yayınlayıp UI'ları senkronla.
            cancelledRide = await hydrateCancelledRide(targetRideId);
            if (!cancelledRide || cancelledRide.status !== 'cancelled') {
              throw firstErr;
            }
            shouldNotifyFcm = false;
          } else {
            throw firstErr;
          }
        } else {
          if (
            firstErr instanceof AppError &&
            firstErr.message.includes("Geçersiz durum geçişi: 'cancelled' → 'cancelled'")
          ) {
            cancelledRide = await hydrateCancelledRide(targetRideId);
            if (!cancelledRide || cancelledRide.status !== 'cancelled') {
              throw firstErr;
            }
            shouldNotifyFcm = false;
          } else {
            throw firstErr;
          }
        }
      }

      // Önce kuyruk + bekleyen sürücüye "istek çekildi" (ride:cancelled room'da sürücü olmayabilir)
      await clearSmartMatchingQueue(targetRideId, true);

      io.to(`ride:${targetRideId}`).emit('ride:cancelled', {
        rideId: targetRideId,
        reason: reason || 'İptal edildi.',
        cancelledBy: role as 'customer' | 'driver',
      });
      // Oda dışında kalmış olsa bile her iki tarafın UI'ı kapanabilsin.
      if (cancelledRide?.customer_id) {
        io.to(`customer:${cancelledRide.customer_id}`).emit('ride:cancelled', {
          rideId: targetRideId,
          reason: reason || 'İptal edildi.',
          cancelledBy: role as 'customer' | 'driver',
        });
      }
      if (cancelledRide?.driver_id) {
        io.to(`driver:${cancelledRide.driver_id}`).emit('ride:cancelled', {
          rideId: targetRideId,
          reason: reason || 'İptal edildi.',
          cancelledBy: role as 'customer' | 'driver',
        });
      }

      io.socketsLeave(`ride:${targetRideId}`);

      // Atanmış sürücü varsa aktif yolculuk cache'ini temizle
      if (cancelledRide?.driver_id) {
        await redis.del(`driver:active_ride:${cancelledRide.driver_id}`);
      }

      if (shouldNotifyFcm && cancelledRide?.customer_id) {
        void notifyRideCancelledByFcm({
          rideId: targetRideId,
          customerId: String(cancelledRide.customer_id),
          driverId: cancelledRide.driver_id,
          scenario: role === 'customer' ? 'customer' : 'driver',
        }).catch((e: unknown) => logger.warn('[FCM] İptal push:', e));
      }

      logger.info(`🚫 Yolculuk iptal edildi: ${targetRideId}, Tarafından: ${role}`);
    } catch (error) {
      logger.error(`ride:cancel hatası [${userId}]:`, error);
      try {
        socket.emit('ride:cancelled', {
          rideId: payload?.rideId ?? '',
          reason: error instanceof AppError ? error.message : 'İptal işlenemedi, tekrar dene.',
          cancelledBy: (role as 'customer' | 'driver') ?? 'customer',
        });
      } catch {
        // ignore
      }
    }
  });
}
